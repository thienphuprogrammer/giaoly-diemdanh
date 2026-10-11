import bcrypt from "bcryptjs";

const COST = 10;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, COST);
export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/** So sánh với hash giả khi email không tồn tại, để thời gian phản hồi không lộ email nào có thật. */
export const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", COST);
