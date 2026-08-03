export const PRIMARY_NAVIGATION = [
  {
    key: "today",
    label: "Today",
    defaultTab: "today",
    tabs: [["today", "Today"]],
  },
  {
    key: "train",
    label: "Train",
    defaultTab: "program",
    tabs: [
      ["program", "Program"],
      ["guide", "Exercise Guide"],
      ["core", "Core"],
      ["hiit", "HIIT"],
      ["mma", "MMA"],
      ["pilates", "Pilates"],
      ["yoga", "Yoga"],
    ],
  },
  {
    key: "progress",
    label: "Progress",
    defaultTab: "history",
    tabs: [
      ["history", "History"],
      ["trends", "Trends"],
      ["macros", "Nutrition"],
    ],
  },
  {
    key: "connect",
    label: "Connect",
    defaultTab: "connections",
    tabs: [
      ["connections", "Connection Center"],
      ["garmin", "Garmin Bridge"],
    ],
  },
  {
    key: "more",
    label: "More",
    defaultTab: "tools",
    tabs: [
      ["tools", "Tools"],
      ["crew", "Crew"],
      ["settings", "Settings"],
    ],
  },
];

const LEGACY_TAB_FALLBACKS = {
  ideas: "settings",
};

export function normalizeTab(tab) {
  return LEGACY_TAB_FALLBACKS[tab] || tab || "today";
}

export function navigationGroupForTab(tab) {
  const normalized = normalizeTab(tab);
  return PRIMARY_NAVIGATION.find(group =>
    group.tabs.some(([tabKey]) => tabKey === normalized)) || PRIMARY_NAVIGATION[0];
}

export function defaultTabForGroup(groupKey) {
  return PRIMARY_NAVIGATION.find(group => group.key === groupKey)?.defaultTab || "today";
}
