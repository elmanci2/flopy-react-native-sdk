package com.remoteupdate

import android.provider.Settings
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.github.difflib.DiffUtils
import com.github.difflib.patch.Patch
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
  fun restartApp(reason: String? = null) {
    try {
      val context = reactContext

      if (BuildConfig.DEBUG) {
        val instanceManager =
                (context.currentActivity?.application as? ReactApplication)
                        ?.reactNativeHost
                        ?.reactInstanceManager

        instanceManager?.let {
          Handler(Looper.getMainLooper()).post {
            try {
              it.recreateReactContextInBackground()
            } catch (t: Throwable) {
              context.currentActivity?.runOnUiThread { context.currentActivity?.recreate() }
            }
          }
        }
      } else {
        com.jakewharton.processphoenix.ProcessPhoenix.triggerRebirth(context)
      }
    } catch (e: Exception) {

      context.currentActivity?.runOnUiThread { context.currentActivity?.recreate() }
    }
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

  /**
   * Aplica un parche en formato "unified diff" a un archivo de texto.
   * @param originalFilePath La ruta absoluta al archivo que será modificado.
   * @param patchString El contenido del parche de texto generado por jsdiff.
   * @param promise Resuelve a `true` si tiene éxito, rechaza si falla.
   */
  @ReactMethod
  fun applyPatch(originalFilePath: String, patchString: String, promise: Promise) {
    try {
      val originalFile = File(originalFilePath)
      if (!originalFile.exists()) {
        promise.reject("APPLY_PATCH_ERROR", "El archivo original no existe: $originalFilePath")
        return
      }

      val originalLines = originalFile.readLines()
      val patch: Patch<String> = DiffUtils.parseUnifiedDiff(patchString.lines())

      val resultLines: List<String> = DiffUtils.patch(originalLines, patch)
      originalFile.writeText(resultLines.joinToString("\n"))

      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("APPLY_PATCH_FAILED", "Ocurrió un error al aplicar el parche: ${e.message}", e)
    }
  }

  @ReactMethod
  fun saveCurrentPackage(packageInfo: ReadableMap, promise: Promise) {
    try {
      val hash = packageInfo.getString("hash")!!
      val relativePath = packageInfo.getString("relativePath")!!
      val releaseId = packageInfo.getString("releaseId")!!

      // Construimos la ruta absoluta que guardaremos
      val flopyDir = reactContext.filesDir.resolve("flopy")
      val absolutePath = File(flopyDir, relativePath).absolutePath

      flopyInstance.saveCurrentPackage(absolutePath, hash, releaseId)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SAVE_PACKAGE_ERROR", e)
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

  companion object {
    const val NAME = "FlopyModule" // Asegúrate que coincida con tu NativeBridge.ts
  }
}
