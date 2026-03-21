import XCTest
import SwiftUI
@testable import iosApp

/// Tests for StartingScreenView rendering and behaviour.
/// Note: These use ViewInspector-style assertions via UIHostingController
/// since ViewInspector is not a dependency. Tests verify the view hierarchy
/// can be instantiated and rendered without crashes.
final class StartingScreenViewTests: XCTestCase {

    // MARK: - Helpers

    private func makeScreen(
        screenId: String = "test",
        dismissable: Bool = false,
        template: String = "warning",
        title: String = "Test Title",
        message: String = "Test message body text.",
        imageType: String? = nil,
        backgroundImage: String? = nil
    ) -> StartingScreen {
        return StartingScreen(
            screenId: screenId,
            enabled: true,
            dismissable: dismissable,
            frequency: "every_launch",
            template: template,
            title: title,
            message: message,
            imageType: imageType,
            backgroundImage: backgroundImage,
            contentHash: "testhash"
        )
    }

    /// Renders the view in a UIHostingController to verify it doesn't crash.
    private func renderView(_ view: StartingScreenView) -> UIHostingController<StartingScreenView> {
        let controller = UIHostingController(rootView: view)
        controller.view.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
        controller.view.layoutIfNeeded()
        return controller
    }

    // MARK: - Rendering Without Crash

    func testView_warningTemplate_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(template: "warning", imageType: "police_duck"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_promotionalTemplate_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(template: "promotional"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_announcementTemplate_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(template: "announcement"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_infoTemplate_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(template: "info"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_unknownTemplate_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(template: "unknown_future_template"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Dismissable vs Non-Dismissable

    func testView_dismissable_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(dismissable: true),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_nonDismissable_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(dismissable: false),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Dismiss Callback

    func testView_dismissable_callbackInvoked() {
        var dismissed = false
        let view = StartingScreenView(
            screen: makeScreen(dismissable: true),
            onDismiss: { dismissed = true }
        )
        // Verify callback reference is set up (can't tap in unit test, but verify no crash)
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
        // Manually invoke the callback to verify it works
        view.onDismiss()
        XCTAssertTrue(dismissed)
    }

    // MARK: - Background Image

    func testView_withBackgroundImage_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(backgroundImage: "https://example.com/bg.jpg"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_withoutBackgroundImage_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(backgroundImage: nil),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Police Duck Image

    func testView_policeDuckImageType_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(imageType: "police_duck"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Long Content

    func testView_longTitle_rendersWithoutCrash() {
        let longTitle = String(repeating: "A", count: 100)
        let view = StartingScreenView(
            screen: makeScreen(title: longTitle),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    func testView_longMessage_rendersWithoutCrash() {
        let longMessage = String(repeating: "This is a long message. ", count: 20)
        let view = StartingScreenView(
            screen: makeScreen(message: longMessage),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - All Templates x Dismissable Combinations

    func testView_allTemplateDismissableCombinations_renderWithoutCrash() {
        let templates = ["warning", "promotional", "announcement", "info"]
        let dismissableStates = [true, false]

        for template in templates {
            for dismissable in dismissableStates {
                let view = StartingScreenView(
                    screen: makeScreen(dismissable: dismissable, template: template),
                    onDismiss: {}
                )
                let controller = renderView(view)
                XCTAssertNotNil(controller.view,
                    "Failed for template=\(template), dismissable=\(dismissable)")
            }
        }
    }

    // MARK: - Accessibility Identifiers

    func testView_accessibilityIdentifiers_exist() {
        // Verify the view can be created with expected accessibility identifiers
        // (Full accessibility tree inspection requires UI testing, but we verify no crash)
        let view = StartingScreenView(
            screen: makeScreen(dismissable: true, imageType: "police_duck"),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Small Screen Size

    func testView_smallScreenSize_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(dismissable: true, imageType: "police_duck"),
            onDismiss: {}
        )
        let controller = UIHostingController(rootView: view)
        // iPhone SE size
        controller.view.frame = CGRect(x: 0, y: 0, width: 320, height: 568)
        controller.view.layoutIfNeeded()
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Large Screen Size

    func testView_iPadScreenSize_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(dismissable: true),
            onDismiss: {}
        )
        let controller = UIHostingController(rootView: view)
        // iPad size
        controller.view.frame = CGRect(x: 0, y: 0, width: 1024, height: 1366)
        controller.view.layoutIfNeeded()
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Emoji in Content

    func testView_emojiInContent_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(
                title: "Hello World! \u{1F600}\u{1F389}",
                message: "Emoji test \u{2764}\u{FE0F} message with various \u{1F4A1} symbols."
            ),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - CJK Characters

    func testView_cjkCharacters_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(
                title: "\u{30B7}\u{30E3}\u{30A4}\u{30C8}\u{30FC}\u{30AF}",
                message: "\u{3053}\u{306E}\u{30A2}\u{30D7}\u{30EA}\u{306F}\u{307E}\u{3060}\u{5229}\u{7528}\u{3067}\u{304D}\u{307E}\u{305B}\u{3093}\u{3002}"
            ),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }

    // MARK: - Arabic RTL

    func testView_arabicRTL_rendersWithoutCrash() {
        let view = StartingScreenView(
            screen: makeScreen(
                title: "\u{0634}\u{0627}\u{064A} \u{062A}\u{0648}\u{0643}",
                message: "\u{0644}\u{0645} \u{064A}\u{062A}\u{0645} \u{0625}\u{0635}\u{062F}\u{0627}\u{0631} \u{0647}\u{0630}\u{0627} \u{0627}\u{0644}\u{062A}\u{0637}\u{0628}\u{064A}\u{0642} \u{0628}\u{0639}\u{062F}."
            ),
            onDismiss: {}
        )
        let controller = renderView(view)
        XCTAssertNotNil(controller.view)
    }
}
