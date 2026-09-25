import { essentialIconSearchData } from "./essentialIconSearchData.ts";

export const essentialIcons = [
  ["message-text", "Chat"],
  ["bot", "Bot"],
  ["star", "Star"],
  ["page", "Document"],
  ["folder", "Folder"],
  ["clock", "Clock"],
  ["bell", "Bell"],
  ["search", "Search"],
  ["computer", "Computer"],
  ["smartphone-device", "Phone"],
  ["key", "Key"],
  ["capabilities", "Capabilities"],
  ["edit-pencil", "Pencil"],
  ["check", "Check"],
  ["play", "Play"],
  ["send", "Send"],
  ["heart", "Heart"],
  ["home", "Home"],
  ["bookmark", "Bookmark"],
  ["book", "Book"],
  ["brain", "Brain"],
  ["light-bulb", "Light Bulb"],
  ["leaf", "Leaf"],
  ["flower", "Flower"],
  ["tree", "Tree"],
  ["cloud", "Cloud"],
  ["music-note", "Music Note"],
  ["camera", "Camera"],
  ["palette", "Palette"],
  ["code", "Code"],
  ["code-brackets", "Code Brackets"],
  ["terminal", "Terminal"],
  ["database", "Database"],
  ["server", "Server"],
  ["globe", "Globe"],
  ["rocket", "Rocket"],
  ["planet", "Planet"],
  ["language", "Language"],
  ["translate", "Translate"],
  ["graduation-cap", "Graduation Cap"],
  ["flask", "Flask"],
  ["dna", "Dna"],
  ["atom", "Atom"],
  ["microscope", "Microscope"],
  ["math-book", "Math Book"],
  ["calculator", "Calculator"],
  ["wallet", "Wallet"],
  ["credit-card", "Credit Card"],
  ["cart", "Cart"],
  ["bag", "Bag"],
  ["suitcase", "Suitcase"],
  ["airplane", "Airplane"],
  ["car", "Car"],
  ["bicycle", "Bicycle"],
  ["train", "Train"],
  ["map", "Map"],
  ["map-pin", "Map Pin"],
  ["compass", "Compass"],
  ["sea-waves", "Sea Waves"],
  ["fish", "Fish"],
  ["running", "Running"],
  ["basketball", "Basketball"],
  ["football", "Football"],
  ["gym", "Gym"],
  ["trophy", "Trophy"],
  ["medal", "Medal"],
  ["gamepad", "Gamepad"],
  ["puzzle", "Puzzle"],
  ["wrench", "Wrench"],
  ["hammer", "Hammer"],
  ["tools", "Tools"],
  ["ruler", "Ruler"],
  ["design-pencil", "Design Pencil"],
  ["color-picker", "Color Picker"],
  ["pen-tablet", "Pen Tablet"],
  ["emoji", "Emoji"],
  ["laptop", "Laptop"],
  ["windows", "Windows"],
  ["linux", "Linux"],
  ["apple", "Apple"],
  ["github", "Github"],
  ["git-branch", "Git Branch"],
  ["calendar", "Calendar"],
  ["journal", "Journal"],
  ["lock", "Lock"],
  ["shield-check", "Shield Check"],
  ["fingerprint", "Fingerprint"],
  ["eye", "Eye"],
  ["light-bulb-on", "Light Bulb On"],
  ["sound-high", "Sound High"],
  ["microphone", "Microphone"],
  ["headset", "Headset"],
  ["network", "Network"],
  ["wifi", "Wifi"],
  ["internet", "Internet"],
  ["link", "Link"],
  ["attachment", "Attachment"],
  ["book-stack", "Book Stack"],
  ["open-book", "Open Book"],
  ["coffee-cup", "Coffee"],
  ["mail", "Email"],
  ["gift", "Gift"],
  ["bed", "Sleep"],
  ["umbrella", "Umbrella"],
  ["building", "Building"],
  ["church", "Faith"],
  ["piggy-bank", "Savings"],
  ["battery-indicator", "Battery"],
  ["bonfire", "Campfire"],
  ["dice-six", "Dice"],
  ["wolf", "Wolf"],
  ["package", "Package"],
  ["director-chair", "Movies"],
  ["lamp", "Lamp"],
  ["fridge", "Kitchen"],
  ["user", "Person"],
] as const;

const reservedIcons = new Set([
  // Icons used by Arura controls and navigation must keep one meaning.
  "attachment",
  "bot",
  "brain",
  "capabilities",
  "message-text",
  "network",
  "check",
  "clock",
  "cloud",
  "computer",
  "edit-pencil",
  "eye",
  "folder",
  "key",
  "page",
  "rocket",
  "search",
  "send",
  "smartphone-device",
  "star",
  "terminal",
  "light-bulb-on",
  "code-brackets",
  "book-stack",
  "open-book",
  "tools",
  "bag",
  "medal",
  "internet",
]);

export const essentialIconChoices = essentialIcons.filter(
  ([icon]) => !reservedIcons.has(icon),
);

const searchAliases: Record<string, string> = {
  bed: "rest bedroom",
  "coffee-cup": "beverage",
  "director-chair": "cinema movie film",
  fridge: "kitchen appliance",
  gift: "present birthday celebration",
  journal: "writing",
  leaf: "sustainability environment",
  wolf: "pet wildlife",
};

function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function searchEssentialIcons(query: string) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return essentialIconChoices;

  return essentialIconChoices
    .map((choice, index) => {
      const [icon, label] = choice;
      const name = normalizeSearch(`${icon} ${label}`);
      const related = normalizeSearch(
        `${essentialIconSearchData[icon] ?? ""} ${searchAliases[icon] ?? ""}`,
      );
      if (
        !terms.every((term) => name.includes(term) || related.includes(term))
      ) {
        return undefined;
      }
      const score = terms.reduce(
        (total, term) => total + (name.includes(term) ? 2 : 1),
        0,
      );
      return { choice, index, score };
    })
    .filter((result) => result !== undefined)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((result) => result.choice);
}
