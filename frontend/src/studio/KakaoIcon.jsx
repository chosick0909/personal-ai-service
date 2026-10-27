// KakaoTalk's mark (yellow square, dark speech bubble) for the 1:1 inquiry links.
export const KAKAO_CHAT = 'http://pf.kakao.com/_HxguxbX/chat'

export default function KakaoIcon({ size = 22 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <rect width="24" height="24" rx="6" fill="#FEE500" />
    <path fill="#3C1E1E" d="M12 5.2c-4.1 0-7.4 2.6-7.4 5.8 0 2.1 1.4 3.9 3.5 4.9l-.7 2.6c-.1.3.2.5.5.3l3.1-2.1c.3 0 .7.1 1 .1 4.1 0 7.4-2.6 7.4-5.8S16.1 5.2 12 5.2z" />
  </svg>
}
