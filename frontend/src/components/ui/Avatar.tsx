import { colorFor, initials } from '@/lib/format';
import type { MemberMini } from '@/types';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}

export function Avatar({ name, src, size = 32, className = '' }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src) return <img className={`avatar ${className}`} src={src} alt={name} title={name} style={style} />;
  return (
    <span className={`avatar ${className}`} title={name} style={{ ...style, background: colorFor(name) }}>
      {initials(name)}
    </span>
  );
}

export function AvatarGroup({ members, extra = 0, size = 28 }: { members: MemberMini[]; extra?: number; size?: number }) {
  return (
    <div className="avatar-group">
      {members.map((m) => (
        <Avatar key={m.id} name={m.name} src={m.avatarUrl} size={size} />
      ))}
      {extra > 0 && (
        <span className="avatar avatar--more" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </div>
  );
}
