//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        // Debug builds of the web extension send lifecycle events here so they can be
        // read with: xcrun simctl spawn booted log stream --predicate 'subsystem == "com.example.CookieAnswers"'
        let logger = Logger(subsystem: "com.example.CookieAnswers", category: "extension")
        logger.notice("event: \(String(describing: message), privacy: .public) (profile: \(profile?.uuidString ?? "none", privacy: .public))")

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [ SFExtensionMessageKey: [ "echo": message ] ]
        } else {
            response.userInfo = [ "message": [ "echo": message ] ]
        }

        context.completeRequest(returningItems: [ response ], completionHandler: nil)
    }

}
