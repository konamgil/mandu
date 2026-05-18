import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { partial } from "../../src/client/island";

describe("partial()", () => {
  test("Render emits a hydratable wrapper with serialized props", () => {
    function Dropdown(props: { label: string }) {
      return React.createElement("button", null, props.label);
    }

    const DropdownPartial = partial({
      component: Dropdown,
      priority: "interaction",
    });

    const html = renderToStaticMarkup(
      React.createElement(DropdownPartial.Render, { label: "Open" }),
    );

    expect(html).toContain('data-mandu-island="Dropdown"');
    expect(html).toContain('data-mandu-partial="Dropdown"');
    expect(html).toContain('data-mandu-src="/.mandu/client/Dropdown.partial.js"');
    expect(html).toContain('data-mandu-priority="interaction"');
    expect(html).toContain('data-hydrate="interaction"');
    expect(html).toContain("data-props=");
    expect(html).toContain("Open");
  });

  test("custom id controls the marker and default bundle URL", () => {
    function SearchBox(props: { query: string }) {
      return React.createElement("input", { defaultValue: props.query });
    }

    const SearchPartial = partial({
      id: "header-search",
      component: SearchBox,
      priority: "immediate",
    });

    const html = renderToStaticMarkup(
      React.createElement(SearchPartial.Render, { query: "mandu" }),
    );

    expect(SearchPartial.__mandu_partial_id).toBe("header-search");
    expect(html).toContain('data-mandu-island="header-search"');
    expect(html).toContain('data-mandu-src="/.mandu/client/header-search.partial.js"');
    expect(html).toContain('data-hydrate="load"');
  });
});
