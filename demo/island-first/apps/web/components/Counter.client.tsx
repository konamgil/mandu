import { island } from "@mandujs/core/client";
import React, { useState, useCallback } from "react";

interface CounterData {
  count: number;
  title: string;
}

export default island<CounterData>({
  setup: (serverData) => {
    const [count, setCount] = useState(serverData.count);
    const increment = useCallback(() => setCount((c: number) => c + 1), []);
    const decrement = useCallback(() => setCount((c: number) => c - 1), []);
    return { count, increment, decrement, title: serverData.title };
  },
  render: ({ count, increment, decrement, title }) => (
    React.createElement("div", { className: "counter-island" },
      React.createElement("h2", null, title),
      React.createElement("div", { className: "counter-controls" },
        React.createElement("button", { onClick: decrement }, "-"),
        React.createElement("span", { className: "count" }, count),
        React.createElement("button", { onClick: increment }, "+")
      )
    )
  ),
});
