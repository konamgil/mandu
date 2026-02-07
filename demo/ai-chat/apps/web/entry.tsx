// Client entry point for Islands hydration
import { createRoot } from 'react-dom/client';
import ChatIsland from '../../src/client/islands/ChatBox';
import TechPanel from '../../src/client/islands/TechPanel';

// Island 컴포넌트 매핑
const islands: Record<string, React.ComponentType<any>> = {
  'chat-box': ChatIsland,
  'tech-panel': TechPanel,
};

// DOM 로드 후 Islands 하이드레이션
function hydrateIslands() {
  const islandElements = document.querySelectorAll('[data-island]');

  islandElements.forEach((element) => {
    const islandName = element.getAttribute('data-island');
    const propsJson = element.getAttribute('data-props') || '{}';

    if (!islandName) return;

    const Component = islands[islandName];
    if (!Component) {
      console.warn(`Island component not found: ${islandName}`);
      return;
    }

    try {
      const props = JSON.parse(propsJson);
      const root = createRoot(element);
      root.render(<Component {...props} />);
      console.log(`[Mandu] Island hydrated: ${islandName}`);
    } catch (error) {
      console.error(`[Mandu] Failed to hydrate island: ${islandName}`, error);
    }
  });
}

// DOM이 준비되면 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
  hydrateIslands();
}
