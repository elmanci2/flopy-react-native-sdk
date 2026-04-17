package com.remoteupdate

import android.provider.Settings
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceManager
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(private val reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  private val flopyInstance: Flopy by lazy { Flopy.getInstance(reactContext) }

  override fun getName(): String = NAME

  private fun getReactInstanceManager(): ReactInstanceManager? {
    val application = reactContext.applicationContext as? ReactApplication
    return application?.reactNativeHost?.reactInstanceManager
  }

  override fun getConstants(): Map<String, Any> {
    val constants = mutableMapOf<String, Any>()
    try {
      val flopyDir = reactContext.filesDir.resolve("flopy")
      constants["flopyPath"] = flopyDir.absolutePath

      val packageManager = reactContext.packageManager
      val packageName = reactContext.packageName
      val packageInfo = packageManager.getPackageInfo(packageName, 0)
      constants["binaryVersion"] = packageInfo.versionName ?: ""

      val contentResolver = reactContext.contentResolver
      val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
      constants["clientUniqueId"] = androidId ?: ""

      // Read from strings.xml if they exist
      constants["serverUrl"] = getStringResourceByName("flopy_server_url") ?: ""
      constants["appId"] = getStringResourceByName("flopy_app_id") ?: ""
      constants["channel"] = getStringResourceByName("flopy_channel") ?: "production"
      constants["deploymentKey"] = getStringResourceByName("flopy_deployment_key") ?: ""

    } catch (e: Exception) {
      constants["flopyPath"] = ""
      constants["binaryVersion"] = ""
      constants["clientUniqueId"] = ""
    }
    return constants
  }

  private fun getStringResourceByName(name: String): String? {
    val resId = reactContext.resources.getIdentifier(name, "string", reactContext.packageName)
    return if (resId != 0) {
      reactContext.getString(resId)
    } else {
      null
    }
  }

  @ReactMethod
  fun mkdir(path: String, promise: Promise) {
    try {
      val dir = File(path)
      if (!dir.exists()) {
        dir.mkdirs()
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MKDIR_ERROR", e)
    }
  }

  @ReactMethod
  fun exists(path: String, promise: Promise) {
    promise.resolve(File(path).exists())
  }

  @ReactMethod
  fun unlink(path: String, promise: Promise) {
    try {
      val file = File(path)
      if (file.exists()) {
        if (file.isDirectory) {
          file.deleteRecursively()
        } else {
          file.delete()
        }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("UNLINK_ERROR", e)
    }
  }

  // Required for NativeEventEmitter support
  @ReactMethod
  fun addListener(eventName: String) {
    // No-op: Required for RN event emitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // No-op: Required for RN event emitter
  }

  private val downloader by lazy { Downloader(reactContext) }

  @ReactMethod
  fun downloadFile(url: String, destination: String, downloadId: String, promise: Promise) {
    downloader.download(url, destination, downloadId, promise)
  }

  @ReactMethod
  fun getSha256(path: String, promise: Promise) {
    try {
      val file = File(path)
      if (!file.exists()) {
        promise.reject("HASH_ERROR", "File not found")
        return
      }
      val digest = java.security.MessageDigest.getInstance("SHA-256")
      val inputStream = file.inputStream()
      val buffer = ByteArray(4096)
      var bytesRead: Int
      while (inputStream.read(buffer).also { bytesRead = it } != -1) {
        digest.update(buffer, 0, bytesRead)
      }
      inputStream.close()
      val hashBytes = digest.digest()
      val hexString = hashBytes.joinToString("") { "%02x".format(it) }
      promise.resolve(hexString)
    } catch (e: Exception) {
      promise.reject("HASH_ERROR", e)
    }
  }

  @ReactMethod
  fun moveFile(from: String, to: String, promise: Promise) {
    try {
      val source = File(from)
      val dest = File(to)
      if (source.renameTo(dest)) {
        promise.resolve(null)
      } else {
        // Fallback for moving across filesystems
        source.copyTo(dest, overwrite = true)
        source.delete()
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.reject("MOVE_ERROR", e)
    }
  }

  @ReactMethod
  fun readDir(path: String, promise: Promise) {
    try {
      val dir = File(path)
      if (!dir.exists() || !dir.isDirectory) {
        promise.resolve(Arguments.createArray())
        return
      }
      val array = Arguments.createArray()
      dir.listFiles()?.forEach { array.pushString(it.name) }
      promise.resolve(array)
    } catch (e: Exception) {
      promise.reject("READ_DIR_ERROR", e)
    }
  }

  @ReactMethod
  fun getFileSize(path: String, promise: Promise) {
    try {
      val file = File(path)
      if (file.exists()) {
        promise.resolve(file.length().toDouble())
      } else {
        promise.resolve(0.0)
      }
    } catch (e: Exception) {
      promise.reject("SIZE_ERROR", e)
    }
  }

  /** Descomprime un archivo .zip en un directorio de destino. */
  @ReactMethod
  fun unzip(zipPath: String, destinationPath: String, promise: Promise) {
    try {
      val zipFile = File(zipPath)
      val destinationDir = File(destinationPath)

      if (!zipFile.exists()) {
        promise.reject("UNZIP_ERROR", "El archivo ZIP de origen no existe: $zipPath")
        return
      }
      if (!destinationDir.exists()) {
        destinationDir.mkdirs()
      }
      if (!destinationDir.isDirectory) {
        promise.reject("UNZIP_ERROR", "La ruta de destino no es un directorio: $destinationPath")
        return
      }

      val zipInputStream = ZipInputStream(zipFile.inputStream().buffered())

      zipInputStream.use { zis ->
        var zipEntry = zis.nextEntry
        while (zipEntry != null) {
          val newFile = File(destinationDir, zipEntry.name)

          if (!newFile.canonicalPath.startsWith(destinationDir.canonicalPath + File.separator)) {
            throw SecurityException("Entrada de ZIP maliciosa: ${zipEntry.name}")
          }

          if (zipEntry.isDirectory) {
            if (!newFile.isDirectory && !newFile.mkdirs()) {
              throw java.io.IOException("Fallo al crear el directorio ${newFile.path}")
            }
          } else {
            val parent = newFile.parentFile
            if (parent != null && !parent.isDirectory && !parent.mkdirs()) {
              throw java.io.IOException("Fallo al crear el directorio padre ${parent.path}")
            }

            val fos = FileOutputStream(newFile)
            val bos = BufferedOutputStream(fos)
            val buffer = ByteArray(4096)
            var read: Int
            while (zis.read(buffer).also { read = it } != -1) {
              bos.write(buffer, 0, read)
            }
            bos.close()
          }
          zipEntry = zis.nextEntry
        }
      }

      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("UNZIP_FAILED", "Ocurrió un error al descomprimir: ${e.message}", e)
    }
  }

  // ========== MÉTODOS EXISTENTES (mantienen compatibilidad) ==========

  @ReactMethod
  fun saveState(state: ReadableMap, promise: Promise) {
    try {
      flopyInstance.saveState(state)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_STATE_ERROR", e)
    }
  }

  @ReactMethod
  fun readState(promise: Promise) {
    try {
      val state = flopyInstance.readState()
      promise.resolve(state)
    } catch (e: Exception) {
      promise.reject("READ_STATE_ERROR", e)
    }
  }

  @ReactMethod
  fun recordFailedBoot() {
    flopyInstance.incrementFailedBootCount()
  }

  @ReactMethod
  fun resetBootStatus() {
    flopyInstance.resetFailedBootCount()
  }

  // ========== NUEVOS MÉTODOS OPTIMIZADOS ==========

  /**
   * Cambia a una nueva versión del bundle (optimizado).
   * @param releaseId ID del release (ej: "release-v1.2.3")
   * @param hash Hash SHA-256 del paquete
   */
  @ReactMethod
  fun switchVersion(releaseId: String, hash: String, promise: Promise) {
    try {
      flopyInstance.switchVersion(releaseId, hash)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("SWITCH_VERSION_ERROR", "Error al cambiar de versión: ${e.message}", e)
    }
  }

  /** Marca la actualización actual como exitosa. Limpia versiones antiguas automáticamente. */
  @ReactMethod
  fun markSuccess(promise: Promise) {
    try {
      flopyInstance.markSuccess()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("MARK_SUCCESS_ERROR", "Error al marcar como exitosa: ${e.message}", e)
    }
  }

  /** Limpia el flag de primera vez (sin marcar como exitosa). */
  @ReactMethod
  fun clearFirstTime(promise: Promise) {
    try {
      flopyInstance.clearFirstTime()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("CLEAR_FIRST_TIME_ERROR", "Error al limpiar flag: ${e.message}", e)
    }
  }

  /** Obtiene la versión que fue revertida (si existe). */
  @ReactMethod
  fun getRolledBackVersion(promise: Promise) {
    try {
      val version = flopyInstance.getRolledBackVersion()
      promise.resolve(version)
    } catch (e: Exception) {
      promise.reject("GET_ROLLBACK_ERROR", "Error al obtener versión revertida: ${e.message}", e)
    }
  }

  /** Limpia la marca de rollback. */
  @ReactMethod
  fun clearRollbackMark(promise: Promise) {
    try {
      flopyInstance.clearRollbackMark()
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("CLEAR_ROLLBACK_ERROR", "Error al limpiar marca de rollback: ${e.message}", e)
    }
  }

  companion object {
    const val NAME = "FlopyModule"
  }
}
