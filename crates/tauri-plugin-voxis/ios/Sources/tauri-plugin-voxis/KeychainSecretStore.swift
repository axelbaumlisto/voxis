import Foundation
import Security

/// SecItem-backed `SecretStore` for the Keychain (Task 8 acceptance #5,
/// `[R1-Safety S2]`). `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`:
/// never syncs via iCloud Keychain and is unreadable while the device is
/// locked -- the strictest accessibility class that still lets a running
/// foreground dictation session read its own API key. Service is fixed
/// at `top.voxis.plugin`; account = the secret's own name (`api_key`,
/// `llm.api_key`, ...), matching `mobile.rs`'s `IosKeychainSecretStore`
/// (`secret_get`/`secret_set`/`secret_delete` `run_mobile_plugin` calls).
///
/// Keys are never logged: every code path below that can fail surfaces
/// only an `OSStatus`/decode-failure enum case, never the secret's own
/// value, in any error it throws.
enum VoxisKeychainSecretStore {
    private static let service = "top.voxis.plugin"

    enum KeychainError: Error {
        case osStatus(OSStatus)
        case decodeFailed
        case encodeFailed
    }

    static func get(name: String) throws -> String? {
        var query = baseQuery(name: name)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let value = String(data: data, encoding: .utf8) else {
                throw KeychainError.decodeFailed
            }
            return value
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError.osStatus(status)
        }
    }

    static func set(name: String, value: String) throws {
        guard let data = value.data(using: .utf8) else { throw KeychainError.encodeFailed }

        // Update-first (same "does it already exist" shape as
        // `FileSecretStore::save`'s load-merge-write, just via SecItem
        // instead of a JSON file): `SecItemUpdate` on a not-yet-existing
        // item returns `errSecItemNotFound`, in which case fall through
        // to `SecItemAdd` with the accessibility attribute set (only
        // meaningful at creation time -- `SecItemUpdate` cannot change
        // `kSecAttrAccessible` on an existing item, so it is deliberately
        // omitted from the update attributes below).
        let updateQuery = baseQuery(name: name)
        let updateAttributes: [String: Any] = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, updateAttributes as CFDictionary)
        if updateStatus == errSecSuccess {
            return
        }
        guard updateStatus == errSecItemNotFound else {
            throw KeychainError.osStatus(updateStatus)
        }

        var addQuery = baseQuery(name: name)
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            throw KeychainError.osStatus(addStatus)
        }
    }

    static func delete(name: String) throws {
        let status = SecItemDelete(baseQuery(name: name) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.osStatus(status)
        }
    }

    private static func baseQuery(name: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: name
        ]
    }
}
