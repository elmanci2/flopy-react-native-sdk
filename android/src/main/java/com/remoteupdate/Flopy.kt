package com.remoteupdate

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import java.io.File

class Flopy(private val context: Context) {
  private val flopyDir = context.filesDir.resolve("flopy")
  private val sp: SharedPreferences =
          context.getSharedPreferences("flopy_prefs", Context.MODE_PRIVATE)

  companion object {
    @Volatile private var instance: Flopy? = null

    fun getInstance(context: Context): Flopy =
            instance
                    ?: synchronized(this) {
                      instance ?: Flopy(context.applicationContext).also { instance = it }
                    }
  }

  init {
    // Crea el directorio si no existe
    if (!flopyDir.exists()) {
      flopyDir.mkdirs()
    }

    // Limpia si cambió la versión de la app
    val currentAppVersion = getAppVersion()
    val storedAppVersion = sp.getString("appVersion", null)

    if (currentAppVersion != storedAppVersion) {
      Log.d("Flopy", "App version changed, cleaning up...")
      sp.edit().clear().apply()
      sp.edit().putString("appVersion", currentAppVersion).apply()
      cleanOldVersions()
    }
  }

  // ========== MÉTODO PRINCIPAL (como pushy) ==========
  fun getJSBundleFile(): String? {
    val startTime = System.currentTimeMillis()

    var currentVersion = sp.getString("currentVersion", null)

    if (currentVersion == null) {
      Log.d("Flopy", "No current version, using assets")
      return null
    }

    // Test rollback si es necesario
    if (!sp.getBoolean("firstTime", false)) {
      if (!sp.getBoolean("firstTimeOk", true)) {
        Log.d("Flopy", "First time NOT OK, rolling back...")
        currentVersion = rollBack()
      }
    }

    // Intenta encontrar un bundle válido
    while (currentVersion != null) {
      val bundleFile = File(flopyDir, "updates/$currentVersion/index.android.bundle")

      if (bundleFile.exists()) {
        val elapsed = System.currentTimeMillis() - startTime
        Log.d("Flopy", "✅ Bundle found in ${elapsed}ms: ${bundleFile.absolutePath}")
        return bundleFile.absolutePath
      }

      Log.e("Flopy", "Bundle not found for version $currentVersion, rolling back...")
      currentVersion = rollBack()
    }

    val elapsed = System.currentTimeMillis() - startTime
    Log.d("Flopy", "No valid bundle found in ${elapsed}ms, using assets")
    return null
  }

  // ========== GESTIÓN DE VERSIONES ==========

  fun switchVersion(releaseId: String, hash: String) {
    val bundleFile = File(flopyDir, "updates/$releaseId/index.android.bundle")
    if (!bundleFile.exists()) {
      throw Error("Bundle version $releaseId not found")
    }

    val lastVersion = sp.getString("currentVersion", null)
    val editor = sp.edit()

    editor.putString("currentVersion", releaseId)
    editor.putString("currentHash", hash)

    if (lastVersion != null && lastVersion != releaseId) {
      editor.putString("lastVersion", lastVersion)
      editor.putString("lastHash", sp.getString("currentHash", null))
    }

    editor.putBoolean("firstTime", true)
    editor.putBoolean("firstTimeOk", false)
    editor.putString("rolledBackVersion", null)
    editor.apply()

    Log.d("Flopy", "Switched to version $releaseId")
  }

  fun markSuccess() {
    val editor = sp.edit()
    editor.putBoolean("firstTimeOk", true)

    val lastVersion = sp.getString("lastVersion", null)
    val curVersion = sp.getString("currentVersion", null)

    if (lastVersion != null && lastVersion != curVersion) {
      editor.remove("lastVersion")
      editor.remove("lastHash")
      // Limpia la versión anterior en background
      Thread {
                try {
                  val oldDir = File(flopyDir, "updates/$lastVersion")
                  if (oldDir.exists()) {
                    oldDir.deleteRecursively()
                    Log.d("Flopy", "Cleaned up old version: $lastVersion")
                  }
                } catch (e: Exception) {
                  Log.e("Flopy", "Error cleaning old version", e)
                }
              }
              .start()
    }

    editor.apply()
    Log.d("Flopy", "Marked as success")
  }

  fun clearFirstTime() {
    sp.edit().putBoolean("firstTime", false).apply()
    Log.d("Flopy", "Cleared first time flag")
  }

  // ========== ROLLBACK ==========

  private fun rollBack(): String? {
    val lastVersion = sp.getString("lastVersion", null)
    val currentVersion = sp.getString("currentVersion", null)
    val editor = sp.edit()

    if (lastVersion == null) {
      editor.remove("currentVersion")
      editor.remove("currentHash")
    } else {
      editor.putString("currentVersion", lastVersion)
      editor.putString("currentHash", sp.getString("lastHash", null))
    }

    editor.putBoolean("firstTimeOk", true)
    editor.putBoolean("firstTime", false)
    editor.putString("rolledBackVersion", currentVersion)
    editor.apply()

    Log.d("Flopy", "Rolled back from $currentVersion to $lastVersion")
    return lastVersion
  }

  // ========== ESTADO PARA JS ==========

  fun readState(): WritableMap? {
    val currentVersion = sp.getString("currentVersion", null)

    if (currentVersion == null) return null

    val state = Arguments.createMap()

    // Current package
    val currentPackage = Arguments.createMap()
    currentPackage.putString("releaseId", currentVersion)
    currentPackage.putString("hash", sp.getString("currentHash", null))
    currentPackage.putString("relativePath", "updates/$currentVersion/index.android.bundle")
    state.putMap("currentPackage", currentPackage)

    // Previous package (si existe)
    val lastVersion = sp.getString("lastVersion", null)
    if (lastVersion != null) {
      val previousPackage = Arguments.createMap()
      previousPackage.putString("releaseId", lastVersion)
      previousPackage.putString("hash", sp.getString("lastHash", null))
      previousPackage.putString("relativePath", "updates/$lastVersion/index.android.bundle")
      state.putMap("previousPackage", previousPackage)
    }

    // Failed boot count (derivado de firstTime y firstTimeOk)
    val failedBootCount =
            if (sp.getBoolean("firstTime", false) && !sp.getBoolean("firstTimeOk", true)) 1 else 0
    state.putInt("failedBootCount", failedBootCount)

    return state
  }

  fun saveState(stateMap: ReadableMap?) {
    if (stateMap == null) return

    try {
      val editor = sp.edit()

      // Current package
      if (stateMap.hasKey("currentPackage")) {
        val currentPackage = stateMap.getMap("currentPackage")
        if (currentPackage != null) {
          editor.putString("currentVersion", currentPackage.getString("releaseId"))
          editor.putString("currentHash", currentPackage.getString("hash"))
        }
      }

      // Previous package
      if (stateMap.hasKey("previousPackage")) {
        val previousPackage = stateMap.getMap("previousPackage")
        if (previousPackage != null) {
          editor.putString("lastVersion", previousPackage.getString("releaseId"))
          editor.putString("lastHash", previousPackage.getString("hash"))
        }
      }

      // Failed boot count
      val failedBootCount = stateMap.getInt("failedBootCount")
      editor.putBoolean("firstTime", failedBootCount > 0)
      editor.putBoolean("firstTimeOk", failedBootCount == 0)

      editor.apply()
      Log.d("Flopy", "State saved")
    } catch (e: Exception) {
      Log.e("Flopy", "Error saving state", e)
    }
  }

  fun incrementFailedBootCount() {
    sp.edit().putBoolean("firstTimeOk", false).apply()
    Log.d("Flopy", "Incremented failed boot count")
  }

  fun resetFailedBootCount() {
    sp.edit().putBoolean("firstTimeOk", true).apply()
    Log.d("Flopy", "Reset failed boot count")
  }

  // ========== UTILIDADES ==========

  private fun getAppVersion(): String {
    return try {
      val packageInfo = context.packageManager.getPackageInfo(context.packageName, 0)
      packageInfo.versionName ?: "1.0.0"
    } catch (e: Exception) {
      "1.0.0"
    }
  }

  private fun cleanOldVersions() {
    Thread {
              try {
                val updatesDir = File(flopyDir, "updates")
                if (updatesDir.exists()) {
                  updatesDir.deleteRecursively()
                  Log.d("Flopy", "Cleaned all old versions")
                }
              } catch (e: Exception) {
                Log.e("Flopy", "Error cleaning old versions", e)
              }
            }
            .start()
  }

  fun getRolledBackVersion(): String? {
    return sp.getString("rolledBackVersion", null)
  }

  fun clearRollbackMark() {
    sp.edit().putString("rolledBackVersion", null).apply()
  }
}
