/**
 * 네이버 마케팅 프록시 - Popup Script
 */

// DOM Elements
const proxyToggle = document.getElementById('proxyToggle');
const changeIPBtn = document.getElementById('changeIPBtn');
const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const proxyIP = document.getElementById('proxyIP');
const lastChanged = document.getElementById('lastChanged');
const loading = document.getElementById('loading');
const btnText = document.querySelector('.btn-text');

// 상태 업데이트
function updateUI(status) {
  const enabled = status.enabled;
  
  // Toggle 상태
  proxyToggle.checked = enabled;
  
  // Status Badge
  statusBadge.className = `status-badge ${enabled ? 'active' : 'inactive'}`;
  statusDot.className = `status-dot ${enabled ? 'active' : 'inactive'}`;
  statusText.textContent = enabled ? '보안 연결됨' : '비활성';
  
  // Proxy IP (세션 ID 기반)
  if (enabled && status.sessionId) {
    proxyIP.textContent = `KR (${status.sessionId.slice(-8)})`;
  } else {
    proxyIP.textContent = '-';
  }
  
  // Last Changed
  if (status.lastChanged) {
    const date = new Date(status.lastChanged);
    const timeStr = date.toLocaleTimeString('ko-KR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    lastChanged.textContent = timeStr;
  } else {
    lastChanged.textContent = '-';
  }
  
  // Change IP Button
  changeIPBtn.disabled = !enabled;
}

// 로딩 상태 표시
function setLoading(isLoading) {
  if (isLoading) {
    loading.classList.add('show');
    btnText.style.display = 'none';
    changeIPBtn.disabled = true;
  } else {
    loading.classList.remove('show');
    btnText.style.display = 'flex';
    changeIPBtn.disabled = !proxyToggle.checked;
  }
}

// 초기 상태 로드
async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getStatus' });
    updateUI(response);
  } catch (error) {
    console.error('Failed to load status:', error);
  }
}

// 프록시 토글
proxyToggle.addEventListener('change', async () => {
  const action = proxyToggle.checked ? 'enableProxy' : 'disableProxy';
  
  try {
    const response = await chrome.runtime.sendMessage({ action });
    
    if (response.success) {
      await loadStatus();
    } else {
      // 실패 시 롤백
      proxyToggle.checked = !proxyToggle.checked;
      alert('프록시 설정 변경에 실패했습니다: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    proxyToggle.checked = !proxyToggle.checked;
    console.error('Toggle failed:', error);
  }
});

// IP 변경 버튼
changeIPBtn.addEventListener('click', async () => {
  setLoading(true);
  
  try {
    const response = await chrome.runtime.sendMessage({ action: 'changeIP' });
    
    if (response.success) {
      await loadStatus();
    } else {
      alert('IP 변경에 실패했습니다: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Change IP failed:', error);
    alert('IP 변경 중 오류가 발생했습니다.');
  } finally {
    setLoading(false);
  }
});

// 초기화
document.addEventListener('DOMContentLoaded', loadStatus);
