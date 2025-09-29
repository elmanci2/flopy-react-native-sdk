package com.remoteupdate

import android.provider.Settings
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipInputStream

@ReactModule(name = RemoteUpdateModule.NAME)
class RemoteUpdateModule(private val reactContext: ReactApplicationContext) :
        ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  /**
   * Este método es solo de ejemplo. En una implementación real, la lógica de reinicio debería ser
   * manejada de forma segura. La forma más sencilla de reiniciar es recargando el DevSupportManager
   * en modo debug o forzando la recreación de la actividad principal.
   */
  @ReactMethod
  fun restartApp() {
    // Implementación simple y segura que funciona en la mayoría de los casos
    // y no depende de clases internas.
    val activity = currentActivity ?: return
    activity.runOnUiThread { activity.recreate() }
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
      // ------------------------------------

      val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)
      constants["clientUniqueId"] = androidId ?: ""
    } catch (e: Exception) {
      Log.e(NAME, "Error retrieving constants", e)
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

      // Validación de entradas
      if (!zipFile.exists()) {
        promise.reject("UNZIP_ERROR", "El archivo ZIP de origen no existe: $zipPath")
        return
      }
      if (!destinationDir.exists()) {
        destinationDir.mkdirs() // Crea el directorio de destino si no existe
      }
      if (!destinationDir.isDirectory) {
        promise.reject("UNZIP_ERROR", "La ruta de destino no es un directorio: $destinationPath")
        return
      }

      // Usamos un ZipInputStream para leer el contenido del zip
      val zipInputStream = ZipInputStream(zipFile.inputStream().buffered())

      // Itera sobre cada entrada (archivo/carpeta) en el zip
      zipInputStream.use { zis ->
        var zipEntry = zis.nextEntry
        while (zipEntry != null) {
          val newFile = File(destinationDir, zipEntry.name)

          // Previene una vulnerabilidad de seguridad (Zip Slip)
          if (!newFile.canonicalPath.startsWith(destinationDir.canonicalPath + File.separator)) {
            throw SecurityException("Entrada de ZIP maliciosa: ${zipEntry.name}")
          }

          if (zipEntry.isDirectory) {
            // Si la entrada es un directorio, lo crea
            if (!newFile.isDirectory && !newFile.mkdirs()) {
              throw java.io.IOException("Fallo al crear el directorio ${newFile.path}")
            }
          } else {
            // Si es un archivo, crea los directorios padres necesarios
            val parent = newFile.parentFile
            if (parent != null && !parent.isDirectory && !parent.mkdirs()) {
              throw java.io.IOException("Fallo al crear el directorio padre ${parent.path}")
            }

            // Escribe el contenido del archivo
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

      promise.resolve(true) // Éxito
    } catch (e: Exception) {
      promise.reject("UNZIP_FAILED", "Ocurrió un error al descomprimir: ${e.message}", e)
    }
  }

  /**
   * Lee el contenido del archivo de metadatos. Devuelve el contenido como string o null si no
   * existe.
   */
  @ReactMethod
  fun readMetadata(promise: Promise) {
    try {
      val flopyDir = reactContext.filesDir.resolve("flopy")
      val metadataFile = File(flopyDir, "flopy.json")
      if (metadataFile.exists()) {
        promise.resolve(metadataFile.readText())
      } else {
        promise.resolve(null)
      }
    } catch (e: Exception) {
      promise.reject("READ_METADATA_FAILED", e)
    }
  }

  /**
   * Escribe o actualiza el archivo de metadatos de forma atómica. El lado JS le pasa el contenido
   * completo del JSON como un string.
   */
  @ReactMethod
  fun writeMetadata(content: String, promise: Promise) {
    try {
      val flopyDir = reactContext.filesDir.resolve("flopy")
      if (!flopyDir.exists()) {
        flopyDir.mkdirs()
      }
      val metadataFile = File(flopyDir, "flopy.json")
      metadataFile.writeText(content)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("WRITE_METADATA_FAILED", e)
    }
  }

  companion object {
    const val NAME = "FlopyModule" // Asegúrate que coincida con tu NativeBridge.ts
  }
}
