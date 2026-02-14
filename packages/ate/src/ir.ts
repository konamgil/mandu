import type { InteractionGraph, InteractionNode, InteractionEdge } from "./types";

export function createEmptyGraph(buildSalt: string): InteractionGraph {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    buildSalt,
    nodes: [],
    edges: [],
    stats: { routes: 0, navigations: 0, modals: 0, actions: 0 },
  };
}

export function addNode(graph: InteractionGraph, node: InteractionNode): void {
  graph.nodes.push(node);
  if (node.kind === "route") graph.stats.routes++;
  if (node.kind === "modal") graph.stats.modals++;
  if (node.kind === "action") graph.stats.actions++;
}

export function addEdge(graph: InteractionGraph, edge: InteractionEdge): void {
  graph.edges.push(edge);
  if (edge.kind === "navigate") graph.stats.navigations++;
}
