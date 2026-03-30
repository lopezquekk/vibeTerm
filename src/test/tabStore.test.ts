import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "../store/tabStore";

beforeEach(() => {
  localStorage.clear();
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    activePanelTab: "terminal",
    sidebarMode: "docked",
  });
});

describe("addTab", () => {
  it("appends a new tab and sets it as active", () => {
    useTabStore.getState().addTab({ alias: "My Project", path: "~/code" });
    const { tabs, activeTabId } = useTabStore.getState();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].alias).toBe("My Project");
    expect(tabs[0].path).toBe("~/code");
    expect(tabs[0].type).toBe("project");
    expect(activeTabId).toBe(tabs[0].id);
  });

  it("generates a unique id for each tab", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    expect(tabs[0].id).not.toBe(tabs[1].id);
  });

  it("respects the type option", () => {
    useTabStore.getState().addTab({ alias: "API", path: "~/api", type: "backend" });
    expect(useTabStore.getState().tabs[0].type).toBe("backend");
  });
});

describe("removeTab", () => {
  it("removes the tab by id", () => {
    useTabStore.getState().addTab({ alias: "X", path: "~" });
    const id = useTabStore.getState().tabs[0].id;
    useTabStore.getState().removeTab(id);
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });

  it("activates the first remaining tab when the active tab is removed", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    // Set first tab as active, then remove it — store falls back to tabs[0] of remaining
    useTabStore.getState().setActiveTab(tabs[0].id);
    useTabStore.getState().removeTab(tabs[0].id);
    expect(useTabStore.getState().activeTabId).toBe(tabs[1].id);
  });

  it("sets activeTabId to null when the last tab is removed", () => {
    useTabStore.getState().addTab({ alias: "Solo", path: "~" });
    const id = useTabStore.getState().tabs[0].id;
    useTabStore.getState().removeTab(id);
    expect(useTabStore.getState().activeTabId).toBeNull();
  });

  it("does not change activeTabId when a non-active tab is removed", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    useTabStore.getState().setActiveTab(tabs[1].id);
    useTabStore.getState().removeTab(tabs[0].id);
    expect(useTabStore.getState().activeTabId).toBe(tabs[1].id);
    expect(useTabStore.getState().tabs).toHaveLength(1);
  });
});

describe("updateTab", () => {
  it("patches the specified tab without changing others", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    const { tabs } = useTabStore.getState();
    useTabStore.getState().updateTab(tabs[0].id, { alias: "Renamed" });
    const after = useTabStore.getState().tabs;
    expect(after[0].alias).toBe("Renamed");
    expect(after[1].alias).toBe("B");
  });

  it("preserves unpatched fields on the updated tab", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a", type: "frontend" });
    const { tabs } = useTabStore.getState();
    useTabStore.getState().updateTab(tabs[0].id, { alias: "Updated" });
    const after = useTabStore.getState().tabs[0];
    expect(after.type).toBe("frontend");
    expect(after.path).toBe("~/a");
  });
});

describe("setSidebarMode", () => {
  it("changes sidebar mode", () => {
    useTabStore.getState().setSidebarMode("floating");
    expect(useTabStore.getState().sidebarMode).toBe("floating");
    useTabStore.getState().setSidebarMode("hidden");
    expect(useTabStore.getState().sidebarMode).toBe("hidden");
    useTabStore.getState().setSidebarMode("docked");
    expect(useTabStore.getState().sidebarMode).toBe("docked");
  });
});

describe("reorderTabs", () => {
  it("moves a tab from one index to another", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    useTabStore.getState().addTab({ alias: "C", path: "~/c" });
    // Move index 0 (A) to index 2 → order should be B, C, A
    useTabStore.getState().reorderTabs(0, 2);
    const { tabs } = useTabStore.getState();
    expect(tabs[0].alias).toBe("B");
    expect(tabs[1].alias).toBe("C");
    expect(tabs[2].alias).toBe("A");
  });

  it("moves a tab from a higher index to a lower index", () => {
    useTabStore.getState().addTab({ alias: "A", path: "~/a" });
    useTabStore.getState().addTab({ alias: "B", path: "~/b" });
    useTabStore.getState().addTab({ alias: "C", path: "~/c" });
    // Move index 2 (C) to index 0 → order should be C, A, B
    useTabStore.getState().reorderTabs(2, 0);
    const { tabs } = useTabStore.getState();
    expect(tabs[0].alias).toBe("C");
    expect(tabs[1].alias).toBe("A");
    expect(tabs[2].alias).toBe("B");
  });
});
