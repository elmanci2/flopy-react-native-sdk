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
    } catch (e: Exception) {
      constants["flopyPath"] = ""
      constants["binaryVersion"] = ""
      constants["clientUniqueId"] = ""
    }
    return constants
  }

  /**
   * Descomprime un archivo .zip en un directorio de destino.
   * @param zipPath La ruta absoluta al archivo .zip a descomprimir.
   * @param destinationPath La ruta absoluta al directorio donde se extraerán los archivos.
   * @param promise Resuelve a `true` si tiene éxito, rechaza si falla.
   */
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
            // Si es un archivo, crea los directorios padres necesarios
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

  companion object {
    const val NAME = "FlopyModule" // Asegúrate que coincida con tu NativeBridge.ts
  }
}
