import SwiftUI

/// Full-screen starting screen overlay.
/// Blocks the app when non-dismissable, or shows a dismissable interstitial.
struct StartingScreenView: View {
    let screen: StartingScreen
    let onDismiss: () -> Void

    /// Template accent colours matching the design spec.
    private var accentColor: Color {
        switch screen.template {
        case "warning":
            return Color(red: 0.906, green: 0.298, blue: 0.235)  // #e74c3c
        case "promotional":
            return Color(red: 0.608, green: 0.349, blue: 0.714)  // #9b59b6
        case "announcement":
            return Color(red: 0.204, green: 0.596, blue: 0.859)  // #3498db
        case "info":
            return Color(red: 0.180, green: 0.800, blue: 0.443)  // #2ecc71
        default:
            return Color(red: 0.204, green: 0.596, blue: 0.859)  // default to blue
        }
    }

    /// Template default icon (SF Symbol) when no custom imageType is set.
    private var templateIconName: String {
        switch screen.template {
        case "warning":
            return "exclamationmark.triangle.fill"
        case "promotional":
            return "gift.fill"
        case "announcement":
            return "megaphone.fill"
        case "info":
            return "info.circle.fill"
        default:
            return "info.circle.fill"
        }
    }

    var body: some View {
        ZStack {
            // Background layer
            backgroundLayer

            // Content layer
            ScrollView {
                VStack(spacing: 24) {
                    Spacer()
                        .frame(height: 40)

                    // ShyTalk branding (always present)
                    brandingSection

                    // Template/custom image
                    imageSection

                    // Title
                    Text(screen.title)
                        .font(.title2)
                        .fontWeight(.bold)
                        .multilineTextAlignment(.center)
                        .foregroundColor(screen.backgroundImage != nil ? .white : .primary)
                        .accessibilityIdentifier("startingScreen_title")

                    // Message
                    Text(screen.message)
                        .font(.body)
                        .multilineTextAlignment(.center)
                        .foregroundColor(screen.backgroundImage != nil ? .white.opacity(0.9) : .secondary)
                        .accessibilityIdentifier("startingScreen_message")

                    // Dismiss button (only when dismissable)
                    if screen.dismissable {
                        Button(action: onDismiss) {
                            Text(NSLocalizedString("starting_screen_dismiss", comment: "Dismiss button"))
                                .font(.headline)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(accentColor)
                        .accessibilityIdentifier("startingScreen_dismissButton")
                        .padding(.top, 8)
                    }

                    Spacer()
                        .frame(height: 40)
                }
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity)
            }
        }
        .ignoresSafeArea()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("startingScreen")
    }

    // MARK: - Background

    @ViewBuilder
    private var backgroundLayer: some View {
        if let bgImageKey = screen.backgroundImage, !bgImageKey.isEmpty {
            // Background image with dark overlay for readability
            ZStack {
                // Async image from URL
                AsyncImage(url: URL(string: bgImageKey)) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure:
                        Color(UIColor.systemBackground)
                    case .empty:
                        Color(UIColor.systemBackground)
                    @unknown default:
                        Color(UIColor.systemBackground)
                    }
                }
                .ignoresSafeArea()

                // Dark overlay (0.6 alpha) for text readability
                Color.black.opacity(0.6)
                    .ignoresSafeArea()
            }
        } else {
            // Solid themed background
            Color(UIColor.systemBackground)
                .ignoresSafeArea()
        }
    }

    // MARK: - Branding

    private var brandingSection: some View {
        VStack(spacing: 8) {
            Image("shytalk_logo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 80, height: 80)
                .cornerRadius(16)
                .accessibilityLabel("ShyTalk")
                .accessibilityIdentifier("startingScreen_logo")

            Text("ShyTalk")
                .font(.largeTitle)
                .fontWeight(.bold)
                .foregroundColor(screen.backgroundImage != nil ? .white : .primary)
                .accessibilityIdentifier("startingScreen_brandName")
        }
    }

    // MARK: - Image

    @ViewBuilder
    private var imageSection: some View {
        if screen.imageType == "police_duck" {
            Image("police_duck")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 160, height: 160)
                .clipShape(Circle())
                .accessibilityLabel(NSLocalizedString("starting_screen_police_duck_description", comment: "Warning illustration"))
                .accessibilityIdentifier("startingScreen_image")
        } else {
            // Template default icon
            Image(systemName: templateIconName)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 60, height: 60)
                .foregroundColor(accentColor)
                .accessibilityHidden(true)
                .accessibilityIdentifier("startingScreen_templateIcon")
        }
    }
}

// MARK: - Preview

#if DEBUG
struct StartingScreenView_Previews: PreviewProvider {
    static var previews: some View {
        StartingScreenView(
            screen: StartingScreen(
                screenId: "preLaunchGate",
                enabled: true,
                dismissable: false,
                frequency: "every_launch",
                template: "warning",
                title: "ShyTalk is not available yet",
                message: "ShyTalk has not been released yet. To apply to test the application, contact Shyden. Testing is available for iOS and Android users.",
                imageType: "police_duck",
                contentHash: "preview"
            ),
            onDismiss: {}
        )
        .previewDisplayName("Blocking - Warning")

        StartingScreenView(
            screen: StartingScreen(
                screenId: "welcome",
                enabled: true,
                dismissable: true,
                frequency: "once",
                template: "announcement",
                title: "Welcome to ShyTalk!",
                message: "We have some exciting new features for you. Enjoy the app!",
                contentHash: "preview2"
            ),
            onDismiss: {}
        )
        .previewDisplayName("Dismissable - Announcement")
    }
}
#endif
