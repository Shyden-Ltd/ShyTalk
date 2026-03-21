import Foundation

struct StartingScreen: Codable, Equatable {
    var screenId: String  // var — set from dictionary key after decoding
    let enabled: Bool
    let dismissable: Bool
    let frequency: String // "every_launch" | "once"
    let template: String // "warning" | "promotional" | "announcement" | "info"
    let title: String
    let message: String
    let imageType: String?
    let backgroundImage: String?
    let startDate: String?
    let endDate: String?
    let contentHash: String
    let lastModifiedAt: String?

    enum CodingKeys: String, CodingKey {
        case screenId = "_screenId"  // Not in API JSON, used for cache round-trip
        case enabled, dismissable, frequency, template, title, message
        case imageType, backgroundImage, startDate, endDate, contentHash, lastModifiedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.screenId = (try? container.decode(String.self, forKey: .screenId)) ?? ""
        self.enabled = try container.decode(Bool.self, forKey: .enabled)
        self.dismissable = try container.decode(Bool.self, forKey: .dismissable)
        self.frequency = try container.decode(String.self, forKey: .frequency)
        self.template = try container.decode(String.self, forKey: .template)
        self.title = try container.decode(String.self, forKey: .title)
        self.message = try container.decode(String.self, forKey: .message)
        self.imageType = try? container.decodeIfPresent(String.self, forKey: .imageType)
        self.backgroundImage = try? container.decodeIfPresent(String.self, forKey: .backgroundImage)
        self.startDate = try? container.decodeIfPresent(String.self, forKey: .startDate)
        self.endDate = try? container.decodeIfPresent(String.self, forKey: .endDate)
        self.contentHash = (try? container.decode(String.self, forKey: .contentHash)) ?? ""
        self.lastModifiedAt = try? container.decodeIfPresent(String.self, forKey: .lastModifiedAt)
    }

    // encode(to:) is auto-synthesised from CodingKeys — screenId is stored under "_screenId"
    // for cache round-trip. API JSON doesn't have _screenId so it's decoded as "" and set externally.

    init(screenId: String, enabled: Bool, dismissable: Bool, frequency: String,
         template: String, title: String, message: String, imageType: String? = nil,
         backgroundImage: String? = nil, startDate: String? = nil, endDate: String? = nil,
         contentHash: String = "", lastModifiedAt: String? = nil) {
        self.screenId = screenId
        self.enabled = enabled
        self.dismissable = dismissable
        self.frequency = frequency
        self.template = template
        self.title = title
        self.message = message
        self.imageType = imageType
        self.backgroundImage = backgroundImage
        self.startDate = startDate
        self.endDate = endDate
        self.contentHash = contentHash
        self.lastModifiedAt = lastModifiedAt
    }
}
