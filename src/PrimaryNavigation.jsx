import React from "react";
import {
  PRIMARY_NAVIGATION,
  defaultTabForGroup,
  navigationGroupForTab,
} from "./navigation.js";

export function PrimaryNavigation({ tab, setTab, hasActiveWorkout }) {
  const activeGroup = navigationGroupForTab(tab);

  return (
    <div className="navigation-shell">
      <nav className="primary-navigation" aria-label="Primary">
        {PRIMARY_NAVIGATION.map(group => (
          <button
            key={group.key}
            type="button"
            className={activeGroup.key === group.key ? "is-active" : ""}
            aria-current={activeGroup.key === group.key ? "page" : undefined}
            onClick={() => setTab(defaultTabForGroup(group.key))}
          >
            {group.label}
            {group.key === "today" && hasActiveWorkout ? <span aria-label="workout in progress">●</span> : null}
          </button>
        ))}
      </nav>

      {activeGroup.tabs.length > 1 ? (
        <nav className="secondary-navigation" aria-label={`${activeGroup.label} sections`}>
          {activeGroup.tabs.map(([tabKey, label]) => (
            <button
              key={tabKey}
              type="button"
              className={tab === tabKey ? "is-active" : ""}
              aria-current={tab === tabKey ? "page" : undefined}
              onClick={() => setTab(tabKey)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
