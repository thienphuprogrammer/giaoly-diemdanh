type ScrollBody = { style: { overflow: string } };
const locks = new WeakMap<ScrollBody, { count: number; previous: string }>();

/** Các hộp thoại cùng chia sẻ khóa cuộn; chỉ hộp cuối đóng mới khôi phục nền. */
export function lockBodyScroll(body: ScrollBody): () => void {
  const lock = locks.get(body) ?? { count: 0, previous: body.style.overflow };
  locks.set(body, lock);
  lock.count += 1;
  body.style.overflow = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.count -= 1;
    if (lock.count === 0) {
      body.style.overflow = lock.previous;
      locks.delete(body);
    }
  };
}
