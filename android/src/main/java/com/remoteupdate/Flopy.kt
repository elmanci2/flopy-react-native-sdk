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
    private const val TAG = "Flopy"

    @Volatile private var instance: Flopy? = null

    fun getInstance(context: Context): Flopy =
            instance
                    ?: synchronized(this) {
                      instance ?: Flopy(context.applicationContext).also { instance = it }
                    }
  }

  init {
    if (!flopyDir.exists()) {
      flopyDir.mkdirs()
    }

    val currentAppVersion = getAppVersion()
    val storedAppVersion = sp.getString("appVersion", null)

    if (currentAppVersion != storedAppVersion) {
      Log.i(TAG, "App version changed from $storedAppVersion to $currentAppVersion")
      sp.edit().clear().apply()
      sp.edit().putString("appVersion", currentAppVersion).apply()
      cleanOldVersions()
    }
  }

  fun getJSBundleFile(): String? {
    val currentVersion = sp.getString("currentVersion", null)
    val firstTime = sp.getBoolean("firstTime", false)
    val firstTimeOk = sp.getBoolean("firstTimeOk", true)

    Log.i(TAG, "getJSBundleFile() - currentVersion: $currentVersion, firstTime: $firstTime, firstTimeOk: $firstTimeOk")

    if (currentVersion == null) {
      Log.i(TAG, "No hay versión OTA, usando bundle nativo")
      return null
    }

    // Si es la primera vez y aún no se ha confirmado, intenta cargar la nueva versión
    if (firstTime && !firstTimeOk) {
      val bundleFile = File(flopyDir, "updates/$currentVersion/index.android.bundle")
      Log.i(TAG, "Primera carga de nueva versión. Bundle path: ${bundleFile.absolutePath}")
      Log.i(TAG, "Bundle existe? ${bundleFile.exists()}")

      if (bundleFile.exists()) {
        return bundleFile.absolutePath
      }

      // Si falla, intenta con la versión anterior
      val lastVersion = sp.getString("lastVersion", null)
      Log.w(TAG, "Bundle de nueva versión no existe, intentando fallback a: $lastVersion")

      if (lastVersion != null) {
        val fallbackBundle = File(flopyDir, "updates/$lastVersion/index.android.bundle")
        if (fallbackBundle.exists()) {
          Log.i(TAG, "Usando bundle de versión anterior: ${fallbackBundle.absolutePath}")
          return fallbackBundle.absolutePath
        }
      }

      Log.e(TAG, "No se encontró ningún bundle válido")
      return null
    }

    // Carga normal: usa la versión actual
    val bundleFile = File(flopyDir, "updates/$currentVersion/index.android.bundle")
    Log.i(TAG, "Carga normal. Bundle path: ${bundleFile.absolutePath}")
    Log.i(TAG, "Bundle existe? ${bundleFile.exists()}")

    return if (bundleFile.exists()) bundleFile.absolutePath else null
  }

  fun switchVersion(releaseId: String, hash: String) {
    val bundleFile = File(flopyDir, "updates/$releaseId/index.android.bundle")

    Log.i(TAG, "switchVersion() - releaseId: $releaseId, hash: $hash")
    Log.i(TAG, "Verificando bundle en: ${bundleFile.absolutePath}")
    Log.i(TAG, "Bundle existe? ${bundleFile.exists()}")

    if (!bundleFile.exists()) {
      throw Error("Bundle version $releaseId not found at ${bundleFile.absolutePath}")
    }

    val lastVersion = sp.getString("currentVersion", null)
    val editor = sp.edit()

    editor.putString("currentVersion", releaseId)
    editor.putString("currentHash", hash)

    if (lastVersion != null && lastVersion != releaseId) {
      Log.i(TAG, "Guardando versión anterior: $lastVersion")
      editor.putString("lastVersion", lastVersion)
      editor.putString("lastHash", sp.getString("currentHash", null))
    }

    editor.putBoolean("firstTime", true)
    editor.putBoolean("firstTimeOk", false)
    editor.putString("rolledBackVersion", null)
    editor.apply()

    Log.i(TAG, "Estado actualizado - firstTime: true, firstTimeOk: false")
  }

  fun markSuccess() {
    Log.i(TAG, "markSuccess() llamado")

    val editor = sp.edit()
    editor.putBoolean("firstTimeOk", true)
    editor.putBoolean("firstTime", false)

    val lastVersion = sp.getString("lastVersion", null)
    val curVersion = sp.getString("currentVersion", null)

    if (lastVersion != null && lastVersion != curVersion) {
      Log.i(TAG, "Limpiando versión anterior: $lastVersion")
      editor.remove("lastVersion")
      editor.remove("lastHash")

      Thread {
        try {
          val oldDir = File(flopyDir, "updates/$lastVersion")
          if (oldDir.exists()) {
            oldDir.deleteRecursively()
            Log.i(TAG, "Versión anterior eliminada: $lastVersion")
          }
        } catch (e: Exception) {
          Log.e(TAG, "Error al eliminar versión anterior", e)
        }
      }.start()
    }

    editor.apply()
    Log.i(TAG, "Estado marcado como exitoso")
  }

  fun clearFirstTime() {
    Log.i(TAG, "clearFirstTime() llamado")
    sp.edit().putBoolean("firstTime", false).apply()
  }

  fun saveState(stateMap: ReadableMap?) {
    if (stateMap == null) return

    try {
      Log.i(TAG, "saveState() llamado con: ${stateMap.toHashMap()}")

      val editor = sp.edit()

      if (stateMap.hasKey("currentPackage")) {
        val currentPackage = stateMap.getMap("currentPackage")
        if (currentPackage != null) {
          val releaseId = currentPackage.getString("releaseId")
          val hash = currentPackage.getString("hash")
          editor.putString("currentVersion", releaseId)
          editor.putString("currentHash", hash)
          Log.i(TAG, "Guardando currentPackage: $releaseId")
        }
      }

      if (stateMap.hasKey("previousPackage")) {
        val previousPackage = stateMap.getMap("previousPackage")
        if (previousPackage != null) {
          val releaseId = previousPackage.getString("releaseId")
          val hash = previousPackage.getString("hash")
          editor.putString("lastVersion", releaseId)
          editor.putString("lastHash", hash)
          Log.i(TAG, "Guardando previousPackage: $releaseId")
        }
      } else {
        editor.remove("lastVersion")
        editor.remove("lastHash")
      }

      if (stateMap.hasKey("pendingUpdate")) {
        val pendingUpdate = stateMap.getMap("pendingUpdate")
        if (pendingUpdate != null) {
          val releaseId = pendingUpdate.getString("releaseId")
          val hash = pendingUpdate.getString("hash")
          val isMandatory = pendingUpdate.getBoolean("isMandatory")
          editor.putString("pendingVersion", releaseId)
          editor.putString("pendingHash", hash)
          editor.putBoolean("pendingIsMandatory", isMandatory)
          Log.i(TAG, "Guardando pendingUpdate: $releaseId")
        }
      } else {
        editor.remove("pendingVersion")
        editor.remove("pendingHash")
        editor.remove("pendingIsMandatory")
      }

      val failedBootCount = stateMap.getInt("failedBootCount")
      editor.putBoolean("firstTime", failedBootCount > 0)
      editor.putBoolean("firstTimeOk", failedBootCount == 0)

      Log.i(TAG, "failedBootCount: $failedBootCount -> firstTime: ${failedBootCount > 0}, firstTimeOk: ${failedBootCount == 0}")

      editor.apply()
      Log.i(TAG, "Estado guardado exitosamente")
    } catch (e: Exception) {
      Log.e(TAG, "Error al guardar estado", e)
    }
  }

  fun readState(): WritableMap? {
    val currentVersion = sp.getString("currentVersion", null)

    Log.i(TAG, "readState() - currentVersion: $currentVersion")

    val state = Arguments.createMap()

    if (currentVersion != null) {
      val currentPackage = Arguments.createMap()
      currentPackage.putString("releaseId", currentVersion)
      currentPackage.putString("hash", sp.getString("currentHash", null))
      currentPackage.putString("relativePath", "updates/$currentVersion/index.android.bundle")
      state.putMap("currentPackage", currentPackage)
    }

    val lastVersion = sp.getString("lastVersion", null)
    if (lastVersion != null) {
      val previousPackage = Arguments.createMap()
      previousPackage.putString("releaseId", lastVersion)
      previousPackage.putString("hash", sp.getString("lastHash", null))
      previousPackage.putString("relativePath", "updates/$lastVersion/index.android.bundle")
      state.putMap("previousPackage", previousPackage)
    }

    val pendingVersion = sp.getString("pendingVersion", null)
    if (pendingVersion != null) {
      val pendingUpdate = Arguments.createMap()
      pendingUpdate.putString("releaseId", pendingVersion)
      pendingUpdate.putString("hash", sp.getString("pendingHash", null))
      pendingUpdate.putString("relativePath", "updates/$pendingVersion/index.android.bundle")
      pendingUpdate.putBoolean("isMandatory", sp.getBoolean("pendingIsMandatory", false))
      state.putMap("pendingUpdate", pendingUpdate)
    }

    val failedBootCount =
            if (sp.getBoolean("firstTime", false) && !sp.getBoolean("firstTimeOk", true)) 1 else 0
    state.putInt("failedBootCount", failedBootCount)

    Log.i(TAG, "Estado leído: ${state.toHashMap()}")

    return if (state.toHashMap().isEmpty()) null else state
  }

  fun incrementFailedBootCount() {
    Log.i(TAG, "incrementFailedBootCount() llamado")
    sp.edit().putBoolean("firstTimeOk", false).apply()
  }

  fun resetFailedBootCount() {
    Log.i(TAG, "resetFailedBootCount() llamado")
    sp.edit().putBoolean("firstTimeOk", true).apply()
  }

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
          Log.i(TAG, "Versiones antiguas eliminadas")
        }
      } catch (e: Exception) {
        Log.e(TAG, "Error al limpiar versiones", e)
      }
    }.start()
  }

  fun getRolledBackVersion(): String? {
    return sp.getString("rolledBackVersion", null)
  }

  fun clearRollbackMark() {
    sp.edit().putString("rolledBackVersion", null).apply()
  }
}
