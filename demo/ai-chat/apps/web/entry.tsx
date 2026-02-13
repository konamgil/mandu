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
      element.innerHTML = `
        <div style="padding:12px; border:1px solid rgba(239,68,68,0.4); background: rgba(127,29,29,0.25); color:#fecaca; border-radius:12px; font-size:14px; line-height:1.5;">
          <strong style="display:block; margin-bottom:4px; color:#fee2e2;">⚠️ UI 로드 실패</strong>
          <span>채팅 인터페이스를 불러오지 못했습니다. 페이지를 새로고침 후 다시 시도해주세요.</span>
        </div>
      `;
    }
  });
}

// DOM이 준비되면 실행
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
  hydrateIslands();
}
