import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * A person's login: one email + password for every business they work in.
 * Each business membership (admin / agent of a business, or the super admin) is a User document
 * pointing here with accountId, so one login can open several businesses.
 */
const accountSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    password: { type: String, required: true, select: false },
    lastUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // business opened last (login lands there)
    lastLoginAt: Date,
    // Phones with the mobile app (Expo push tokens): alerts of every business of this login
    pushTokens: { type: [{ _id: false, token: String, platform: String, device: String, at: Date }], default: [] },
  },
  { timestamps: true }
);

accountSchema.pre('save', async function () {
  // Migrated accounts get the bcrypt hash copied from the old user record: never hash a hash
  if (this.isModified('password') && !/^\$2[aby]\$\d{2}\$/.test(this.password)) this.password = await bcrypt.hash(this.password, 10);
});

accountSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

accountSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export default mongoose.model('Account', accountSchema);
