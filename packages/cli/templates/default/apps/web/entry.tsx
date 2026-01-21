import React from "react";
import type { ReactElement } from "react";

export interface AppContext {
  routeId: string;
  url: string;
  params: Record<string, string>;
}

type RouteComponent = (props: { params: Record<string, string> }) => ReactElement;

const routeComponents: Record<string, RouteComponent> = {};

export function registerRoute(routeId: string, component: RouteComponent): void {
  routeComponents[routeId] = component;
}

export function createApp(context: AppContext): ReactElement {
  const Component = routeComponents[context.routeId];

  if (!Component) {
    return (
      <div>
        <h1>404 - Route Not Found</h1>
        <p>Route ID: {context.routeId}</p>
      </div>
    );
  }

  return <Component params={context.params} />;
}

export function getRegisteredRoutes(): string[] {
  return Object.keys(routeComponents);
}
