/**
 * 네이버 마케팅 프록시 - Background Service Worker
 * 
 * PAC Script 기반 분할 터널링:
 * - *.naver.com, naver.com → Bright Data Proxy 경유
 * - 그 외 모든 트래픽 → DIRECT (보안 프로그램 충돌 방지)
 */

// ===== Bright Data 설정 =====
const BRIGHT_DATA_CONFIG = {
  host: 'brd.superproxy.io',
  port: 33335,
  username: 'brd-customer-hl_aedf68fd-zone-residential_proxy1',
  password: 'tea6bnxp4zg3',
  country: 'kr'
};

// ===== 상태 관리 =====
let proxyEnabled = false;
let currentSessionId = '';
let currentIP = '';

// ===== PAC Script 생성 함수 =====
function generatePacScript(sessionId) {
  const { host, port, username, password, country } = BRIGHT_DATA_CONFIG;
  
  // 세션 ID가 있으면 username에 추가 (IP 유지용)
  const fullUsername = sessionId 
    ? `${username}-country-${country}-session-${sessionId}`
    : `${username}-country-${country}`;
  
  // PAC Script: 네이버 도메인만 프록시, 나머지는 DIRECT
  const pacScript = `
    function FindProxyForURL(url, host) {
      // 네이버 도메인 체크
      if (shExpMatch(host, "*.naver.com") || 
          shExpMatch(host, "naver.com") ||
          shExpMatch(host, "*.navercorp.com")) {
        return "PROXY ${host}:${port}";
      }
      
      // 그 외 모든 트래픽은 DIRECT (보안 프로그램 충돌 방지)
      return "DIRECT";
    }
  `;
  
  return {
    pacScript,
    proxyAuth: {
      username: fullUsername,
      password: password
    }
  };
}

// ===== 세션 ID 생성 =====
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// ===== 프록시 활성화 =====
async function enableProxy(newSessionId = null) {
  try {
    // 새 세션 ID 생성 (IP 변경용)
    currentSessionId = newSessionId || generateSessionId();
    
    const { pacScript, proxyAuth } = generatePacScript(currentSessionId);
    
    // PAC Script 기반 프록시 설정
    const config = {
      mode: 'pac_script',
      pacScript: {
        data: pacScript
      }
    };
    
    await chrome.proxy.settings.set({
      value: config,
      scope: 'regular'
    });
    
    // 프록시 인증 설정
    chrome.webRequest?.onAuthRequired?.addListener(
      (details, callback) => {
        if (details.isProxy) {
          callback({
            authCredentials: proxyAuth
          });
        }
      },
      { urls: ['<all_urls>'] },
      ['asyncBlocking']
    );
    
    proxyEnabled = true;
    
    // 상태 저장
    await chrome.storage.local.set({
      proxyEnabled: true,
      sessionId: currentSessionId,
      lastChanged: Date.now()
    });
    
    // 아이콘 업데이트 (활성 상태)
    updateIcon(true);
    
    console.log('[Proxy] Enabled with session:', currentSessionId);
    
    return {
      success: true,
      sessionId: currentSessionId,
      status: 'enabled'
    };
    
  } catch (error) {
    console.error('[Proxy] Enable failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== 프록시 비활성화 =====
async function disableProxy() {
  try {
    // 시스템 기본값으로 복원
    await chrome.proxy.settings.clear({
      scope: 'regular'
    });
    
    proxyEnabled = false;
    currentSessionId = '';
    
    // 상태 저장
    await chrome.storage.local.set({
      proxyEnabled: false,
      sessionId: '',
      lastChanged: Date.now()
    });
    
    // 아이콘 업데이트 (비활성 상태)
    updateIcon(false);
    
    console.log('[Proxy] Disabled');
    
    return {
      success: true,
      status: 'disabled'
    };
    
  } catch (error) {
    console.error('[Proxy] Disable failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== IP 변경 (새 세션 생성) =====
async function changeIP() {
  try {
    // 새 세션 ID로 프록시 재설정
    const newSessionId = generateSessionId();
    const result = await enableProxy(newSessionId);
    
    if (result.success) {
      console.log('[Proxy] IP changed, new session:', newSessionId);
      return {
        success: true,
        sessionId: newSessionId,
        message: 'IP가 성공적으로 변경되었습니다.'
      };
    }
    
    return result;
    
  } catch (error) {
    console.error('[Proxy] IP change failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== 현재 상태 조회 =====
async function getStatus() {
  const data = await chrome.storage.local.get(['proxyEnabled', 'sessionId', 'lastChanged']);
  
  return {
    enabled: data.proxyEnabled || false,
    sessionId: data.sessionId || '',
    lastChanged: data.lastChanged || null,
    config: {
      host: BRIGHT_DATA_CONFIG.host,
      port: BRIGHT_DATA_CONFIG.port,
      country: BRIGHT_DATA_CONFIG.country
    }
  };
}

// ===== 아이콘 업데이트 =====
function updateIcon(enabled) {
  const iconPath = enabled ? {
    16: 'icons/icon16-active.png',
    48: 'icons/icon48-active.png',
    128: 'icons/icon128-active.png'
  } : {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
  };
  
  // 아이콘이 없을 경우 기본 아이콘 사용
  chrome.action.setIcon({ path: iconPath }).catch(() => {
    chrome.action.setIcon({ 
      path: {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      }
    });
  });
  
  // 뱃지 업데이트
  chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
  chrome.action.setBadgeBackgroundColor({ color: enabled ? '#22c55e' : '#6b7280' });
}

// ===== 외부 메시지 수신 (웹사이트에서 호출) =====
chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    console.log('[Extension] External message received:', request.action);
    
    // 허용된 도메인 확인
    const allowedOrigins = [
      'https://insurance-content-master.pages.dev',
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ];
    
    const senderOrigin = sender.origin || sender.url?.split('/').slice(0, 3).join('/');
    
    if (!allowedOrigins.some(origin => senderOrigin?.startsWith(origin.replace('/*', '')))) {
      console.warn('[Extension] Unauthorized origin:', senderOrigin);
      sendResponse({ success: false, error: 'Unauthorized origin' });
      return true;
    }
    
    // 액션 처리
    (async () => {
      let result;
      
      switch (request.action) {
        case 'enableProxy':
          result = await enableProxy();
          break;
          
        case 'disableProxy':
          result = await disableProxy();
          break;
          
        case 'changeIP':
          result = await changeIP();
          break;
          
        case 'getStatus':
          result = await getStatus();
          break;
          
        case 'ping':
          result = { success: true, message: 'Extension is active', version: '1.0.0' };
          break;
          
        default:
          result = { success: false, error: 'Unknown action' };
      }
      
      sendResponse(result);
    })();
    
    // 비동기 응답을 위해 true 반환
    return true;
  }
);

// ===== 내부 메시지 수신 (Popup에서 호출) =====
chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {
    console.log('[Extension] Internal message received:', request.action);
    
    (async () => {
      let result;
      
      switch (request.action) {
        case 'enableProxy':
          result = await enableProxy();
          break;
          
        case 'disableProxy':
          result = await disableProxy();
          break;
          
        case 'changeIP':
          result = await changeIP();
          break;
          
        case 'getStatus':
          result = await getStatus();
          break;
          
        default:
          result = { success: false, error: 'Unknown action' };
      }
      
      sendResponse(result);
    })();
    
    return true;
  }
);

// ===== 초기화 =====
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[Extension] Installed - 네이버 마케팅 프록시');
  
  // 기본 상태 저장
  await chrome.storage.local.set({
    proxyEnabled: false,
    sessionId: '',
    lastChanged: null
  });
  
  updateIcon(false);
});

// ===== 시작 시 상태 복원 =====
chrome.runtime.onStartup.addListener(async () => {
  const data = await chrome.storage.local.get(['proxyEnabled', 'sessionId']);
  
  if (data.proxyEnabled && data.sessionId) {
    // 이전 세션 복원
    await enableProxy(data.sessionId);
    console.log('[Extension] Restored previous session:', data.sessionId);
  } else {
    updateIcon(false);
  }
});

// ===== 프록시 에러 핸들링 =====
chrome.proxy.onProxyError.addListener((details) => {
  console.error('[Proxy Error]', details);
});

console.log('[Extension] Background service worker loaded');
