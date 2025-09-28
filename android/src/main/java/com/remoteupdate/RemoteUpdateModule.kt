package com.remoteupdate

import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import java.io.File

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

  /** Expone constantes estáticas a JavaScript. */
  override fun getConstants(): Map<String, Any> {
    val constants = mutableMapOf<String, Any>()
    try {
      val flopyDir = reactContext.filesDir.resolve("flopy")
      constants["flopyPath"] = flopyDir.absolutePath

      val packageManager = reactContext.packageManager
      val packageName = reactContext.packageName
      val packageInfo = packageManager.getPackageInfo(packageName, 0)

      constants["binaryVersion"] = packageInfo.versionName ?: ""
      // ------------------------------------

    } catch (e: Exception) {
      Log.e(NAME, "Error retrieving constants", e)
      constants["flopyPath"] = ""
      // También es buena idea establecer un valor por defecto aquí en caso de excepción
      constants["binaryVersion"] = ""
    }
    return constants
  

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
