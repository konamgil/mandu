---
"@mandujs/core": patch
"@mandujs/cli": patch
---

feat(devtools): add restart button and replace badge emoji with text

- DevTools 패널에 캐시 클리어 + 완전 재시작 버튼 추가
- HMR 서버에 POST /restart 엔드포인트 및 CORS 지원 추가
- 플로팅 배지 🥟 이모지를 "MK" 텍스트로 교체 (크로스 플랫폼 호환)
- SSR/Streaming SSR에 window.__MANDU_HMR_PORT__ 노출
