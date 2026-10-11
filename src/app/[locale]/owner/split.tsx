/** Put a React node where a message had the placeholder \u0001. */
export function split(msg: string, node: React.ReactNode) {
  const [a, b = ''] = msg.split('\u0001');
  return <>{a}{node}{b}</>;
}
