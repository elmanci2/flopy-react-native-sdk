import Foundation
import UIKit
import Compression

@objc(FlopyModule)
class FlopyModule: RCTEventEmitter {
  
  private lazy var downloader = Downloader(bridge: self.bridge)

  override func supportedEvents() -> [String]! {
    return ["downloadProgress", "downloadFinished", "downloadError"]
  }

  @objc
  override func constantsToExport() -> [AnyHashable : Any]! {
    let infoDict = Bundle.main.infoDictionary
    
    return [
      "flopyPath": NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first! + "/flopy",
      "binaryVersion": infoDict?["CFBundleShortVersionString"] as? String ?? "",
      "clientUniqueId": UIDevice.current.identifierForVendor?.uuidString ?? "",
      "serverUrl": infoDict?["FlopyServerUrl"] as? String ?? "",
      "appId": infoDict?["FlopyAppId"] as? String ?? "",
      "channel": infoDict?["FlopyChannel"] as? String ?? "production",
      "deploymentKey": infoDict?["FlopyDeploymentKey"] as? String ?? ""
    ]
  }

  @objc
  func mkdir(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      try FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true, attributes: nil)
      resolve(nil)
    } catch {
      reject("MKDIR_ERROR", error.localizedDescription, error)
    }
  }

  @objc
  func exists(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(FileManager.default.fileExists(atPath: path))
  }

  @objc
  func unlink(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      if FileManager.default.fileExists(atPath: path) {
        try FileManager.default.removeItem(atPath: path)
      }
      resolve(nil)
    } catch {
      reject("UNLINK_ERROR", error.localizedDescription, error)
    }
  }

  @objc
  override static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func downloadFile(_ urlString: String, destination: String, downloadId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let url = URL(string: urlString) else {
      reject("DOWNLOAD_ERROR", "Invalid URL", nil)
      return
    }
    
    downloader.download(url: url, destination: destination, downloadId: downloadId, resolve: resolve, reject: reject)
  }

  @objc
  func getSha256(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    // C5: Lectura incremental para evitar OOM en bundles grandes
    DispatchQueue.global(qos: .userInitiated).async {
      guard FileManager.default.fileExists(atPath: path) else {
        reject("HASH_ERROR", "File not found", nil)
        return
      }

      guard let fileHandle = FileHandle(forReadingAtPath: path) else {
        reject("HASH_ERROR", "Could not open file for reading", nil)
        return
      }
      defer { fileHandle.closeFile() }

      var context = CC_SHA256_CTX()
      CC_SHA256_Init(&context)

      let bufferSize = 64 * 1024 // 64KB chunks
      while true {
        let data = fileHandle.readData(ofLength: bufferSize)
        if data.isEmpty { break }
        data.withUnsafeBytes { rawBufferPointer in
          _ = CC_SHA256_Update(&context, rawBufferPointer.baseAddress, CC_LONG(data.count))
        }
      }

      var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
      CC_SHA256_Final(&hash, &context)

      let res = hash.map { String(format: "%02x", $0) }.joined()
      resolve(res)
    }
  }

  @objc
  func moveFile(_ from: String, to: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      try FileManager.default.moveItem(atPath: from, toPath: to)
      resolve(nil)
    } catch {
      reject("MOVE_ERROR", error.localizedDescription, error)
    }
  }

  @objc
  func readDir(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      let files = try FileManager.default.contentsOfDirectory(atPath: path)
      resolve(files)
    } catch {
      reject("READ_DIR_ERROR", error.localizedDescription, error)
    }
  }

  @objc
  func getFileSize(_ path: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    do {
      let attrs = try FileManager.default.attributesOfItem(atPath: path)
      resolve(attrs[.size] as? UInt64 ?? 0)
    } catch {
      reject("SIZE_ERROR", error.localizedDescription, error)
    }
  }

  @objc
  func unzip(_ zipPath: String, destinationPath: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.global(qos: .userInitiated).async {
      let fileManager = FileManager.default
      let destURL = URL(fileURLWithPath: destinationPath)

      do {
        // Crear directorio destino
        if !fileManager.fileExists(atPath: destinationPath) {
          try fileManager.createDirectory(at: destURL, withIntermediateDirectories: true)
        }

        // Verificar que el ZIP existe
        guard fileManager.fileExists(atPath: zipPath) else {
          reject("UNZIP_ERROR", "ZIP file does not exist: \(zipPath)", nil)
          return
        }

        // Usar FileManager para descomprimir (disponible desde iOS 9+ con zlib)
        // iOS no tiene API nativa de alto nivel para ZIP, así que usamos
        // un enfoque con Data y la estructura ZIP
        let zipURL = URL(fileURLWithPath: zipPath)
        guard let zipData = try? Data(contentsOf: zipURL) else {
          reject("UNZIP_ERROR", "Could not read ZIP file", nil)
          return
        }

        // Extraer usando el parser ZIP manual (formato estándar)
        let success = self.extractZipManual(zipData: zipData, to: destURL)
        if success {
          resolve(true)
        } else {
          reject("UNZIP_ERROR", "Failed to extract ZIP. Consider adding ZIPFoundation pod for better support.", nil)
        }
      } catch {
        reject("UNZIP_ERROR", error.localizedDescription, error)
      }
    }
  }

  // Parser ZIP minimalista usando la estructura del formato ZIP
  // Soporta archivos sin compresión (stored) y con deflate
  private func extractZipManual(zipData: Data, to destinationURL: URL) -> Bool {
    let fileManager = FileManager.default
    let destPath = destinationURL.standardized.path
    var offset = 0

    while offset + 4 <= zipData.count {
      // Leer firma del local file header (0x04034b50)
      let sig = zipData.subdata(in: offset..<(offset + 4)).withUnsafeBytes { $0.load(as: UInt32.self) }
      guard sig == 0x04034b50 else { break } // No more local headers

      guard offset + 30 <= zipData.count else { return false }

      let compressionMethod = zipData.subdata(in: (offset + 8)..<(offset + 10)).withUnsafeBytes { $0.load(as: UInt16.self) }
      let compressedSize = zipData.subdata(in: (offset + 18)..<(offset + 22)).withUnsafeBytes { $0.load(as: UInt32.self) }
      let uncompressedSize = zipData.subdata(in: (offset + 22)..<(offset + 26)).withUnsafeBytes { $0.load(as: UInt32.self) }
      let fileNameLength = Int(zipData.subdata(in: (offset + 26)..<(offset + 28)).withUnsafeBytes { $0.load(as: UInt16.self) })
      let extraFieldLength = Int(zipData.subdata(in: (offset + 28)..<(offset + 30)).withUnsafeBytes { $0.load(as: UInt16.self) })

      let headerEnd = offset + 30
      guard headerEnd + fileNameLength <= zipData.count else { return false }

      let fileNameData = zipData.subdata(in: headerEnd..<(headerEnd + fileNameLength))
      guard let fileName = String(data: fileNameData, encoding: .utf8) else {
        offset = headerEnd + fileNameLength + extraFieldLength + Int(compressedSize)
        continue
      }

      let dataStart = headerEnd + fileNameLength + extraFieldLength
      let dataEnd = dataStart + Int(compressedSize)
      guard dataEnd <= zipData.count else { return false }

      let entryURL = destinationURL.appendingPathComponent(fileName)
      let entryPath = entryURL.standardized.path

      // Zip Slip protection
      guard entryPath.hasPrefix(destPath) else {
        offset = dataEnd
        continue
      }

      do {
        if fileName.hasSuffix("/") {
          // Es un directorio
          try fileManager.createDirectory(atPath: entryPath, withIntermediateDirectories: true, attributes: nil)
        } else {
          // Crear directorio padre
          let parentDir = entryURL.deletingLastPathComponent()
          try fileManager.createDirectory(at: parentDir, withIntermediateDirectories: true)

          let compressedData = zipData.subdata(in: dataStart..<dataEnd)

          if compressionMethod == 0 {
            // Stored (sin compresión)
            try compressedData.write(to: entryURL)
          } else if compressionMethod == 8 {
            // Deflate — usar Compression framework de iOS
            let decompressed = self.inflateData(compressedData, expectedSize: Int(uncompressedSize))
            guard let data = decompressed else { return false }
            try data.write(to: entryURL)
          } else {
            // Método de compresión no soportado
            return false
          }
        }
      } catch {
        return false
      }

      offset = dataEnd
    }

    return true
  }

  // Descomprimir datos deflate usando Compression framework
  // M3: Buffer progresivo para manejar ratios de compresión altos y expectedSize=0
  private func inflateData(_ data: Data, expectedSize: Int) -> Data? {
    let initialCapacity = expectedSize > 0
      ? max(expectedSize, data.count * 2)
      : max(data.count * 8, 1024)

    // Intenta con buffers progresivamente más grandes
    for multiplier in [1, 4, 16] {
      let capacity = initialCapacity * multiplier
      let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: capacity)

      let size = data.withUnsafeBytes { (rawBuffer: UnsafeRawBufferPointer) -> Int in
        guard let src = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return 0 }
        return compression_decode_buffer(
          buffer, capacity,
          src, data.count,
          nil,
          COMPRESSION_ZLIB
        )
      }

      if size > 0 && size < capacity {
        let result = Data(bytes: buffer, count: size)
        buffer.deallocate()
        return result
      }
      buffer.deallocate()
    }
    return nil
  }

  // MARK: - State Management (UserDefaults)

  private var defaults: UserDefaults {
    return UserDefaults.standard
  }

  private let kCurrentVersion = "flopy_currentVersion"
  private let kCurrentHash = "flopy_currentHash"
  private let kLastVersion = "flopy_lastVersion"
  private let kLastHash = "flopy_lastHash"
  private let kPendingVersion = "flopy_pendingVersion"
  private let kPendingHash = "flopy_pendingHash"
  private let kPendingIsMandatory = "flopy_pendingIsMandatory"
  private let kFirstTime = "flopy_firstTime"
  private let kFirstTimeOk = "flopy_firstTimeOk"
  private let kRolledBackVersion = "flopy_rolledBackVersion"
  private let kAppVersion = "flopy_appVersion"

  @objc
  func saveState(_ state: NSDictionary, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    if let currentPackage = state["currentPackage"] as? NSDictionary {
      defaults.set(currentPackage["releaseId"] as? String, forKey: kCurrentVersion)
      defaults.set(currentPackage["hash"] as? String, forKey: kCurrentHash)
    } else {
      // CRÍTICO: Si currentPackage es nil, limpiar la versión actual
      // para que la app vuelva al bundle nativo
      defaults.removeObject(forKey: kCurrentVersion)
      defaults.removeObject(forKey: kCurrentHash)
    }

    if let previousPackage = state["previousPackage"] as? NSDictionary {
      defaults.set(previousPackage["releaseId"] as? String, forKey: kLastVersion)
      defaults.set(previousPackage["hash"] as? String, forKey: kLastHash)
    } else {
      defaults.removeObject(forKey: kLastVersion)
      defaults.removeObject(forKey: kLastHash)
    }

    if let pendingUpdate = state["pendingUpdate"] as? NSDictionary {
      defaults.set(pendingUpdate["releaseId"] as? String, forKey: kPendingVersion)
      defaults.set(pendingUpdate["hash"] as? String, forKey: kPendingHash)
      defaults.set(pendingUpdate["isMandatory"] as? Bool ?? false, forKey: kPendingIsMandatory)
    } else {
      defaults.removeObject(forKey: kPendingVersion)
      defaults.removeObject(forKey: kPendingHash)
      defaults.removeObject(forKey: kPendingIsMandatory)
    }

    let failedBootCount = state["failedBootCount"] as? Int ?? 0
    defaults.set(failedBootCount > 0, forKey: kFirstTime)
    defaults.set(failedBootCount == 0, forKey: kFirstTimeOk)

    defaults.synchronize()
    resolve(true)
  }

  @objc
  func readState(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    var state: [String: Any] = [:]

    if let currentVersion = defaults.string(forKey: kCurrentVersion) {
      state["currentPackage"] = [
        "releaseId": currentVersion,
        "hash": defaults.string(forKey: kCurrentHash) ?? "",
        "relativePath": "updates/\(currentVersion)/main.jsbundle"
      ]
    }

    if let lastVersion = defaults.string(forKey: kLastVersion) {
      state["previousPackage"] = [
        "releaseId": lastVersion,
        "hash": defaults.string(forKey: kLastHash) ?? "",
        "relativePath": "updates/\(lastVersion)/main.jsbundle"
      ]
    }

    if let pendingVersion = defaults.string(forKey: kPendingVersion) {
      state["pendingUpdate"] = [
        "releaseId": pendingVersion,
        "hash": defaults.string(forKey: kPendingHash) ?? "",
        "relativePath": "updates/\(pendingVersion)/main.jsbundle",
        "isMandatory": defaults.bool(forKey: kPendingIsMandatory)
      ]
    }

    let firstTime = defaults.bool(forKey: kFirstTime)
    let firstTimeOk = defaults.bool(forKey: kFirstTimeOk)
    state["failedBootCount"] = (firstTime && !firstTimeOk) ? 1 : 0

    if state.isEmpty {
      resolve(nil)
    } else {
      resolve(state)
    }
  }

  @objc
  func recordFailedBoot() {
    defaults.set(false, forKey: kFirstTimeOk)
    defaults.synchronize()
  }

  @objc
  func resetBootStatus() {
    defaults.set(true, forKey: kFirstTimeOk)
    defaults.synchronize()
  }

  @objc
  func switchVersion(_ releaseId: String, hash: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let flopyPath = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first! + "/flopy"
    let bundlePath = "\(flopyPath)/updates/\(releaseId)/main.jsbundle"

    guard FileManager.default.fileExists(atPath: bundlePath) else {
      reject("SWITCH_ERROR", "Bundle not found at \(bundlePath)", nil)
      return
    }

    let lastVersion = defaults.string(forKey: kCurrentVersion)
    let lastHash = defaults.string(forKey: kCurrentHash)

    defaults.set(releaseId, forKey: kCurrentVersion)
    defaults.set(hash, forKey: kCurrentHash)

    if let lv = lastVersion, lv != releaseId {
      defaults.set(lv, forKey: kLastVersion)
      defaults.set(lastHash, forKey: kLastHash)
    }

    defaults.set(true, forKey: kFirstTime)
    defaults.set(false, forKey: kFirstTimeOk)
    defaults.removeObject(forKey: kRolledBackVersion)
    defaults.synchronize()

    resolve(nil)
  }

  @objc
  func markSuccess(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    defaults.set(true, forKey: kFirstTimeOk)
    defaults.set(false, forKey: kFirstTime)

    let lastVersion = defaults.string(forKey: kLastVersion)
    let curVersion = defaults.string(forKey: kCurrentVersion)

    if let lv = lastVersion, lv != curVersion {
      defaults.removeObject(forKey: kLastVersion)
      defaults.removeObject(forKey: kLastHash)

      DispatchQueue.global(qos: .background).async {
        let flopyPath = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first! + "/flopy"
        let oldDir = "\(flopyPath)/updates/\(lv)"
        try? FileManager.default.removeItem(atPath: oldDir)
      }
    }

    defaults.synchronize()
    resolve(nil)
  }

  @objc
  func clearFirstTime(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    defaults.set(false, forKey: kFirstTime)
    defaults.synchronize()
    resolve(nil)
  }

  @objc
  func getRolledBackVersion(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    resolve(defaults.string(forKey: kRolledBackVersion))
  }

  @objc
  func clearRollbackMark(_ resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    defaults.removeObject(forKey: kRolledBackVersion)
    defaults.synchronize()
    resolve(nil)
  }
}
