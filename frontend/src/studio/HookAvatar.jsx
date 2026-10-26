import avatar from './assets/hookai-avatar.webp'

// 훅ai's face wherever 훅ai speaks: the chat header, its question card and the waiting card.
export default function HookAvatar({ size = 34 }) {
  return <img className="st-avatar-img" src={avatar} alt="훅ai" width={size} height={size} style={{ width: size, height: size }} />
}
