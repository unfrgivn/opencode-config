import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  getPluginSymlinkName,
  createPluginInstall,
  createPluginInstalls,
  createPluginSymlink,
  createPluginSymlinks,
  getRemotePluginInstalls,
  getRemotePluginInstallsForRepo,
  getRemotePluginSymlinks,
  cleanupStalePluginInstalls,
  cleanupStalePluginInstallsForRepo,
  cleanupStalePluginSymlinks,
  findBrokenUnmanagedPluginLinks,
  isRemotePluginInstall,
  isRemotePluginSymlink,
  ensurePluginDir,
  getPluginInstallPath,
  getPluginSymlinkPath,
} from "./plugin-install"
import type { PluginInfo } from "./plugin-info"

describe("plugin-install", () => {
  // Use a temp directory for all filesystem tests
  let testPluginDir: string
  let testSourceDir: string

  beforeEach(() => {
    testPluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugin-dir-"))
    testSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-source-dir-"))
  })

  afterEach(() => {
    if (testPluginDir && fs.existsSync(testPluginDir)) {
      fs.rmSync(testPluginDir, { recursive: true })
    }
    if (testSourceDir && fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true })
    }
  })

  describe("getPluginSymlinkName", () => {
    test("generates correct name for simple plugin", () => {
      const plugin: PluginInfo = {
        name: "notify",
        path: "/some/path/notify.ts",
        repoShortName: "my-hooks",
        extension: ".ts",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_my-hooks_notify.ts")
    })

    test("generates correct name for plugin with dashes", () => {
      const plugin: PluginInfo = {
        name: "utils-helpers-logger",
        path: "/some/path/utils/helpers/logger.ts",
        repoShortName: "shared-plugins",
        extension: ".ts",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_shared-plugins_utils-helpers-logger.ts")
    })

    test("generates correct name for .js plugin", () => {
      const plugin: PluginInfo = {
        name: "legacy-hook",
        path: "/some/path/legacy-hook.js",
        repoShortName: "old-repo",
        extension: ".js",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_old-repo_legacy-hook.js")
    })

    test("handles underscores in names", () => {
      const plugin: PluginInfo = {
        name: "my_plugin_v2",
        path: "/some/path/my_plugin_v2.ts",
        repoShortName: "test_repo",
        extension: ".ts",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_test_repo_my_plugin_v2.ts")
    })
  })

  describe("isRemotePluginInstall", () => {
    test("returns true for _remote_ prefixed names", () => {
      expect(isRemotePluginInstall("_remote_my-repo_notify.ts")).toBe(true)
      expect(isRemotePluginInstall("_remote_foo_bar.js")).toBe(true)
    })

    test("returns false for non-remote names", () => {
      expect(isRemotePluginInstall("my-plugin.ts")).toBe(false)
      expect(isRemotePluginInstall("remote_plugin.ts")).toBe(false)
      expect(isRemotePluginInstall("_local_plugin.ts")).toBe(false)
    })
  })

  describe("isRemotePluginSymlink (deprecated)", () => {
    test("delegates to isRemotePluginInstall", () => {
      expect(isRemotePluginSymlink("_remote_my-repo_notify.ts")).toBe(true)
      expect(isRemotePluginSymlink("my-plugin.ts")).toBe(false)
    })
  })

  describe("ensurePluginDir", () => {
    test("creates directory if it does not exist", () => {
      const newDir = path.join(testPluginDir, "new-subdir")
      expect(fs.existsSync(newDir)).toBe(false)
      
      ensurePluginDir(newDir)
      
      expect(fs.existsSync(newDir)).toBe(true)
    })

    test("does nothing if directory already exists", () => {
      expect(fs.existsSync(testPluginDir)).toBe(true)
      
      ensurePluginDir(testPluginDir)
      
      expect(fs.existsSync(testPluginDir)).toBe(true)
    })
  })

  describe("createPluginInstall", () => {
    describe("with link mode (default)", () => {
      test("creates symlink successfully", () => {
        // Create a source file to link to
        const sourceFile = path.join(testSourceDir, "source.ts")
        fs.writeFileSync(sourceFile, `export default {}`)
        
        const plugin: PluginInfo = {
          name: "test-plugin",
          path: sourceFile,
          repoShortName: "test-repo",
          extension: ".ts",
        }
        
        const result = createPluginInstall(plugin, testPluginDir)
        
        expect(result.pluginName).toBe("test-plugin")
        expect(result.symlinkName).toBe("_remote_test-repo_test-plugin.ts")
        expect(result.targetPath).toBe(sourceFile)
        expect(result.error).toBeUndefined()
        
        // Verify symlink was actually created
        const installPath = path.join(testPluginDir, "_remote_test-repo_test-plugin.ts")
        expect(fs.existsSync(installPath)).toBe(true)
        expect(fs.lstatSync(installPath).isSymbolicLink()).toBe(true)
        expect(fs.readlinkSync(installPath)).toBe(sourceFile)
      })

      test("replaces existing symlink", () => {
        const sourceFile1 = path.join(testSourceDir, "source1.ts")
        const sourceFile2 = path.join(testSourceDir, "source2.ts")
        fs.writeFileSync(sourceFile1, `export default { v: 1 }`)
        fs.writeFileSync(sourceFile2, `export default { v: 2 }`)
        
        const plugin1: PluginInfo = {
          name: "plugin",
          path: sourceFile1,
          repoShortName: "repo",
          extension: ".ts",
        }
        
        const plugin2: PluginInfo = {
          name: "plugin",
          path: sourceFile2,
          repoShortName: "repo",
          extension: ".ts",
        }
        
        createPluginInstall(plugin1, testPluginDir)
        const result = createPluginInstall(plugin2, testPluginDir)
        
        expect(result.error).toBeUndefined()
        
        // Verify symlink points to new source
        const installPath = path.join(testPluginDir, "_remote_repo_plugin.ts")
        expect(fs.readlinkSync(installPath)).toBe(sourceFile2)
      })

      test("handles broken symlinks (race condition)", () => {
        // This simulates the race condition where a symlink exists but points to a
        // now-nonexistent target (e.g., from a previous failed sync)
        const sourceFile1 = path.join(testSourceDir, "source1.ts")
        const sourceFile2 = path.join(testSourceDir, "source2.ts")
        fs.writeFileSync(sourceFile1, `export default { v: 1 }`)
        fs.writeFileSync(sourceFile2, `export default { v: 2 }`)
        
        const installPath = path.join(testPluginDir, "_remote_repo_plugin.ts")
        
        // Create a symlink to a file that will be deleted
        fs.symlinkSync(sourceFile1, installPath)
        expect(fs.existsSync(installPath)).toBe(true)
        
        // Delete the target to make the symlink broken
        fs.unlinkSync(sourceFile1)
        expect(fs.existsSync(installPath)).toBe(false) // Broken symlink
        expect(fs.lstatSync(installPath).isSymbolicLink()).toBe(true) // But it's still a symlink
        
        // Now try to create a new symlink to a different target
        const plugin: PluginInfo = {
          name: "plugin",
          path: sourceFile2,
          repoShortName: "repo",
          extension: ".ts",
        }
        
        const result = createPluginInstall(plugin, testPluginDir)
        
        // Should succeed (not fail with EEXIST)
        expect(result.error).toBeUndefined()
        
        // Verify symlink now points to the new source
        expect(fs.readlinkSync(installPath)).toBe(sourceFile2)
        expect(fs.existsSync(installPath)).toBe(true)
      })

      test("reports error for non-existent source", () => {
        const plugin: PluginInfo = {
          name: "missing",
          path: "/non/existent/file.ts",
          repoShortName: "repo",
          extension: ".ts",
        }
        
        // Note: fs.symlinkSync doesn't check if target exists, so this will succeed
        // The error would only be visible when trying to read the symlink
        const result = createPluginInstall(plugin, testPluginDir)
        
        // Symlink creation succeeds even for non-existent targets
        expect(result.error).toBeUndefined()
      })
    })

    describe("with copy mode", () => {
      test("copies file successfully", () => {
        const sourceFile = path.join(testSourceDir, "source.ts")
        const sourceContent = `export default { mode: "copy" }`
        fs.writeFileSync(sourceFile, sourceContent)
        
        const plugin: PluginInfo = {
          name: "test-plugin",
          path: sourceFile,
          repoShortName: "test-repo",
          extension: ".ts",
        }
        
        const result = createPluginInstall(plugin, testPluginDir, "copy")
        
        expect(result.pluginName).toBe("test-plugin")
        expect(result.symlinkName).toBe("_remote_test-repo_test-plugin.ts")
        expect(result.targetPath).toBe(sourceFile)
        expect(result.error).toBeUndefined()
        
        // Verify file was copied (not symlink)
        const installPath = path.join(testPluginDir, "_remote_test-repo_test-plugin.ts")
        expect(fs.existsSync(installPath)).toBe(true)
        expect(fs.lstatSync(installPath).isSymbolicLink()).toBe(false)
        expect(fs.lstatSync(installPath).isFile()).toBe(true)
        expect(fs.readFileSync(installPath, "utf-8")).toBe(sourceContent)
      })

      test("replaces existing file", () => {
        const sourceFile1 = path.join(testSourceDir, "source1.ts")
        const sourceFile2 = path.join(testSourceDir, "source2.ts")
        const content1 = `export default { v: 1 }`
        const content2 = `export default { v: 2 }`
        fs.writeFileSync(sourceFile1, content1)
        fs.writeFileSync(sourceFile2, content2)
        
        const plugin1: PluginInfo = {
          name: "plugin",
          path: sourceFile1,
          repoShortName: "repo",
          extension: ".ts",
        }
        
        const plugin2: PluginInfo = {
          name: "plugin",
          path: sourceFile2,
          repoShortName: "repo",
          extension: ".ts",
        }
        
        createPluginInstall(plugin1, testPluginDir, "copy")
        const result = createPluginInstall(plugin2, testPluginDir, "copy")
        
        expect(result.error).toBeUndefined()
        
        // Verify file has new content
        const installPath = path.join(testPluginDir, "_remote_repo_plugin.ts")
        expect(fs.readFileSync(installPath, "utf-8")).toBe(content2)
      })

      test("replaces existing symlink with copy", () => {
        const sourceFile1 = path.join(testSourceDir, "source1.ts")
        const sourceFile2 = path.join(testSourceDir, "source2.ts")
        const content2 = `export default { v: 2, copied: true }`
        fs.writeFileSync(sourceFile1, `export default { v: 1 }`)
        fs.writeFileSync(sourceFile2, content2)
        
        const installPath = path.join(testPluginDir, "_remote_repo_plugin.ts")
        
        // Create a symlink first
        fs.symlinkSync(sourceFile1, installPath)
        expect(fs.lstatSync(installPath).isSymbolicLink()).toBe(true)
        
        // Now replace with copy
        const plugin: PluginInfo = {
          name: "plugin",
          path: sourceFile2,
          repoShortName: "repo",
          extension: ".ts",
        }
        
        const result = createPluginInstall(plugin, testPluginDir, "copy")
        
        expect(result.error).toBeUndefined()
        expect(fs.lstatSync(installPath).isSymbolicLink()).toBe(false)
        expect(fs.lstatSync(installPath).isFile()).toBe(true)
        expect(fs.readFileSync(installPath, "utf-8")).toBe(content2)
      })

      test("reports error for non-existent source", () => {
        const plugin: PluginInfo = {
          name: "missing",
          path: "/non/existent/file.ts",
          repoShortName: "repo",
          extension: ".ts",
        }
        
        const result = createPluginInstall(plugin, testPluginDir, "copy")
        
        // Copy mode should fail for non-existent source
        expect(result.error).toBeDefined()
      })
    })
  })

  describe("createPluginSymlink (deprecated)", () => {
    test("creates symlink successfully", () => {
      // Create a source file to link to
      const sourceFile = path.join(testSourceDir, "source.ts")
      fs.writeFileSync(sourceFile, `export default {}`)
      
      const plugin: PluginInfo = {
        name: "test-plugin",
        path: sourceFile,
        repoShortName: "test-repo",
        extension: ".ts",
      }
      
      const result = createPluginSymlink(plugin, testPluginDir)
      
      expect(result.pluginName).toBe("test-plugin")
      expect(result.symlinkName).toBe("_remote_test-repo_test-plugin.ts")
      expect(result.targetPath).toBe(sourceFile)
      expect(result.error).toBeUndefined()
      
      // Verify symlink was actually created
      const symlinkPath = path.join(testPluginDir, "_remote_test-repo_test-plugin.ts")
      expect(fs.existsSync(symlinkPath)).toBe(true)
      expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true)
      expect(fs.readlinkSync(symlinkPath)).toBe(sourceFile)
    })
  })

  describe("createPluginInstalls", () => {
    test("installs multiple plugins with link mode", () => {
      const sourceFile1 = path.join(testSourceDir, "plugin1.ts")
      const sourceFile2 = path.join(testSourceDir, "plugin2.js")
      fs.writeFileSync(sourceFile1, `export default {}`)
      fs.writeFileSync(sourceFile2, `module.exports = {}`)
      
      const plugins: PluginInfo[] = [
        {
          name: "plugin1",
          path: sourceFile1,
          repoShortName: "repo-a",
          extension: ".ts",
        },
        {
          name: "plugin2",
          path: sourceFile2,
          repoShortName: "repo-b",
          extension: ".js",
        },
      ]
      
      const results = createPluginInstalls(plugins, testPluginDir, "link")
      
      expect(results).toHaveLength(2)
      expect(results[0].symlinkName).toBe("_remote_repo-a_plugin1.ts")
      expect(results[1].symlinkName).toBe("_remote_repo-b_plugin2.js")
      
      // Verify both symlinks exist
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo-a_plugin1.ts"))).toBe(true)
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo-b_plugin2.js"))).toBe(true)
      expect(fs.lstatSync(path.join(testPluginDir, "_remote_repo-a_plugin1.ts")).isSymbolicLink()).toBe(true)
    })

    test("installs multiple plugins with copy mode", () => {
      const sourceFile1 = path.join(testSourceDir, "plugin1.ts")
      const sourceFile2 = path.join(testSourceDir, "plugin2.js")
      const content1 = `export default { plugin: 1 }`
      const content2 = `module.exports = { plugin: 2 }`
      fs.writeFileSync(sourceFile1, content1)
      fs.writeFileSync(sourceFile2, content2)
      
      const plugins: PluginInfo[] = [
        {
          name: "plugin1",
          path: sourceFile1,
          repoShortName: "repo-a",
          extension: ".ts",
        },
        {
          name: "plugin2",
          path: sourceFile2,
          repoShortName: "repo-b",
          extension: ".js",
        },
      ]
      
      const results = createPluginInstalls(plugins, testPluginDir, "copy")
      
      expect(results).toHaveLength(2)
      expect(results[0].error).toBeUndefined()
      expect(results[1].error).toBeUndefined()
      
      // Verify both files exist and are copies (not symlinks)
      const path1 = path.join(testPluginDir, "_remote_repo-a_plugin1.ts")
      const path2 = path.join(testPluginDir, "_remote_repo-b_plugin2.js")
      expect(fs.existsSync(path1)).toBe(true)
      expect(fs.existsSync(path2)).toBe(true)
      expect(fs.lstatSync(path1).isSymbolicLink()).toBe(false)
      expect(fs.lstatSync(path2).isSymbolicLink()).toBe(false)
      expect(fs.readFileSync(path1, "utf-8")).toBe(content1)
      expect(fs.readFileSync(path2, "utf-8")).toBe(content2)
    })

    test("returns empty array for empty input", () => {
      const results = createPluginInstalls([], testPluginDir)
      expect(results).toHaveLength(0)
    })
  })

  describe("createPluginSymlinks (deprecated)", () => {
    test("creates symlinks for multiple plugins", () => {
      const sourceFile1 = path.join(testSourceDir, "plugin1.ts")
      const sourceFile2 = path.join(testSourceDir, "plugin2.js")
      fs.writeFileSync(sourceFile1, `export default {}`)
      fs.writeFileSync(sourceFile2, `module.exports = {}`)
      
      const plugins: PluginInfo[] = [
        {
          name: "plugin1",
          path: sourceFile1,
          repoShortName: "repo-a",
          extension: ".ts",
        },
        {
          name: "plugin2",
          path: sourceFile2,
          repoShortName: "repo-b",
          extension: ".js",
        },
      ]
      
      const results = createPluginSymlinks(plugins, testPluginDir)
      
      expect(results).toHaveLength(2)
      expect(results[0].symlinkName).toBe("_remote_repo-a_plugin1.ts")
      expect(results[1].symlinkName).toBe("_remote_repo-b_plugin2.js")
    })

    test("returns empty array for empty input", () => {
      const results = createPluginSymlinks([], testPluginDir)
      expect(results).toHaveLength(0)
    })
  })

  describe("getRemotePluginInstalls", () => {
    test("returns empty array when directory does not exist", () => {
      const nonExistentDir = path.join(testPluginDir, "does-not-exist")
      const result = getRemotePluginInstalls(nonExistentDir)
      expect(result).toEqual([])
    })

    test("returns empty array when directory is empty", () => {
      const result = getRemotePluginInstalls(testPluginDir)
      expect(result).toEqual([])
    })

    test("returns only _remote_ prefixed files", () => {
      // Create some files
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin1.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_other_plugin2.js"), "")
      fs.writeFileSync(path.join(testPluginDir, "local-plugin.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "another-local.js"), "")
      
      const result = getRemotePluginInstalls(testPluginDir)
      
      expect(result).toHaveLength(2)
      expect(result.sort()).toEqual([
        "_remote_other_plugin2.js",
        "_remote_repo_plugin1.ts",
      ])
    })

    test("aggregates from multiple directories", () => {
      const anotherPluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugin-dir-extra-"))
      try {
        fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin1.ts"), "")
        fs.writeFileSync(path.join(anotherPluginDir, "_remote_repo_plugin2.ts"), "")
        fs.writeFileSync(path.join(anotherPluginDir, "local-plugin.ts"), "")

        const result = getRemotePluginInstalls([testPluginDir, anotherPluginDir])

        expect(result.sort()).toEqual([
          "_remote_repo_plugin1.ts",
          "_remote_repo_plugin2.ts",
        ])
      } finally {
        fs.rmSync(anotherPluginDir, { recursive: true })
      }
    })
  })

  describe("getRemotePluginInstallsForRepo", () => {
    test("filters to the specified repository prefix", () => {
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo-a_plugin1.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo-b_plugin2.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo-a_plugin3.ts"), "")

      const result = getRemotePluginInstallsForRepo("repo-a", testPluginDir)

      expect(result.sort()).toEqual([
        "_remote_repo-a_plugin1.ts",
        "_remote_repo-a_plugin3.ts",
      ])
    })
  })

  describe("getRemotePluginSymlinks (deprecated)", () => {
    test("delegates to getRemotePluginInstalls", () => {
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin1.ts"), "")
      
      const result = getRemotePluginSymlinks(testPluginDir)
      
      expect(result).toHaveLength(1)
      expect(result[0]).toBe("_remote_repo_plugin1.ts")
    })
  })

  describe("cleanupStalePluginInstalls", () => {
    test("removes stale files not in current set", () => {
      // Create some remote files
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_keep.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_remove1.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_remove2.js"), "")
      fs.writeFileSync(path.join(testPluginDir, "local-plugin.ts"), "")
      
      const currentInstalls = new Set(["_remote_repo_keep.ts"])
      const result = cleanupStalePluginInstalls(currentInstalls, testPluginDir)
      
      expect(result.removed.sort()).toEqual([
        "_remote_repo_remove1.ts",
        "_remote_repo_remove2.js",
      ])
      expect(result.errors).toEqual([])
      
      // Verify files are actually removed
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo_keep.ts"))).toBe(true)
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo_remove1.ts"))).toBe(false)
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo_remove2.js"))).toBe(false)
      // Local plugin should be untouched
      expect(fs.existsSync(path.join(testPluginDir, "local-plugin.ts"))).toBe(true)
    })

    test("removes both symlinks and regular files", () => {
      const sourceFile = path.join(testSourceDir, "source.ts")
      fs.writeFileSync(sourceFile, "content")
      
      // Create a symlink
      fs.symlinkSync(sourceFile, path.join(testPluginDir, "_remote_repo_symlink.ts"))
      // Create a regular file
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_copy.ts"), "copied content")
      
      const result = cleanupStalePluginInstalls(new Set(), testPluginDir)
      
      expect(result.removed.sort()).toEqual([
        "_remote_repo_copy.ts",
        "_remote_repo_symlink.ts",
      ])
      expect(result.errors).toEqual([])
      
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo_symlink.ts"))).toBe(false)
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo_copy.ts"))).toBe(false)
    })

    test("returns empty removed array when no stale installs", () => {
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin.ts"), "")
      
      const currentInstalls = new Set(["_remote_repo_plugin.ts"])
      const result = cleanupStalePluginInstalls(currentInstalls, testPluginDir)
      
      expect(result.removed).toEqual([])
      expect(result.errors).toEqual([])
    })

    test("handles empty current set (removes all remote installs)", () => {
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin1.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin2.ts"), "")
      
      const result = cleanupStalePluginInstalls(new Set(), testPluginDir)
      
      expect(result.removed.sort()).toEqual([
        "_remote_repo_plugin1.ts",
        "_remote_repo_plugin2.ts",
      ])
    })

    test("cleans stale installs across multiple directories", () => {
      const anotherPluginDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-plugin-dir-extra-"))
      try {
        fs.writeFileSync(path.join(testPluginDir, "_remote_repo_keep.ts"), "")
        fs.writeFileSync(path.join(anotherPluginDir, "_remote_repo_remove.ts"), "")

        const currentInstalls = new Set(["_remote_repo_keep.ts"])
        const result = cleanupStalePluginInstalls(currentInstalls, [testPluginDir, anotherPluginDir])

        expect(result.removed).toEqual(["_remote_repo_remove.ts"])
        expect(fs.existsSync(path.join(testPluginDir, "_remote_repo_keep.ts"))).toBe(true)
        expect(fs.existsSync(path.join(anotherPluginDir, "_remote_repo_remove.ts"))).toBe(false)
      } finally {
        fs.rmSync(anotherPluginDir, { recursive: true })
      }
    })
  })

  describe("cleanupStalePluginInstallsForRepo", () => {
    test("removes stale installs only for the target repo", () => {
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo-a_keep.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo-a_remove.ts"), "")
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo-b_keep.ts"), "")

      const currentInstalls = new Set(["_remote_repo-a_keep.ts"])
      const result = cleanupStalePluginInstallsForRepo("repo-a", currentInstalls, testPluginDir)

      expect(result.removed).toEqual(["_remote_repo-a_remove.ts"])
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo-a_keep.ts"))).toBe(true)
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo-a_remove.ts"))).toBe(false)
      expect(fs.existsSync(path.join(testPluginDir, "_remote_repo-b_keep.ts"))).toBe(true)
    })
  })

  describe("findBrokenUnmanagedPluginLinks", () => {
    test("returns unmanaged broken symlinks and ignores remote installs", () => {
      const existingTarget = path.join(testSourceDir, "existing.ts")
      const missingTarget = path.join(testSourceDir, "missing.ts")
      fs.writeFileSync(existingTarget, "export default {}")

      const unmanagedBrokenPath = path.join(testPluginDir, "oh-my-opencode")
      const unmanagedValidPath = path.join(testPluginDir, "local-plugin")
      const remoteBrokenPath = path.join(testPluginDir, "_remote_repo_plugin.ts")

      fs.symlinkSync(missingTarget, unmanagedBrokenPath)
      fs.symlinkSync(existingTarget, unmanagedValidPath)
      fs.symlinkSync(missingTarget, remoteBrokenPath)

      const result = findBrokenUnmanagedPluginLinks(testPluginDir)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe("oh-my-opencode")
      expect(result[0].path).toBe(unmanagedBrokenPath)
      expect(result[0].targetPath).toBe(missingTarget)
    })
  })

  describe("cleanupStalePluginSymlinks (deprecated)", () => {
    test("delegates to cleanupStalePluginInstalls", () => {
      fs.writeFileSync(path.join(testPluginDir, "_remote_repo_plugin.ts"), "")
      
      const result = cleanupStalePluginSymlinks(new Set(), testPluginDir)
      
      expect(result.removed).toEqual(["_remote_repo_plugin.ts"])
    })
  })

  describe("getPluginInstallPath", () => {
    test("returns correct path with custom directory", () => {
      const result = getPluginInstallPath("_remote_repo_plugin.ts", testPluginDir)
      expect(result).toBe(path.join(testPluginDir, "_remote_repo_plugin.ts"))
    })
  })

  describe("getPluginSymlinkPath (deprecated)", () => {
    test("delegates to getPluginInstallPath", () => {
      const result = getPluginSymlinkPath("_remote_repo_plugin.ts", testPluginDir)
      expect(result).toBe(path.join(testPluginDir, "_remote_repo_plugin.ts"))
    })
  })

  describe("symlink naming edge cases", () => {
    test("handles repo name with numbers", () => {
      const plugin: PluginInfo = {
        name: "hook",
        path: "/path/hook.ts",
        repoShortName: "my-repo-v2",
        extension: ".ts",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_my-repo-v2_hook.ts")
    })

    test("handles plugin name with numbers", () => {
      const plugin: PluginInfo = {
        name: "hook123",
        path: "/path/hook123.ts",
        repoShortName: "repo",
        extension: ".ts",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_repo_hook123.ts")
    })

    test("handles deeply nested plugin converted to dashes", () => {
      const plugin: PluginInfo = {
        name: "utils-helpers-formatters-date",
        path: "/path/utils/helpers/formatters/date.ts",
        repoShortName: "shared",
        extension: ".ts",
      }
      
      expect(getPluginSymlinkName(plugin)).toBe("_remote_shared_utils-helpers-formatters-date.ts")
    })
  })
})
