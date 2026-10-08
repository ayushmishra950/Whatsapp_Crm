import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const ROLES = ['super_admin', 'admin', 'agent'];

const userSchema = new mongoose.Schema(
  {
    // One User = one membership: this person's role in one business (or the super admin).
    // The login (email + password) is the Account; one Account can have Users in several businesses.
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', index: true },
    // null only for super_admin
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', index: true, default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true }, // copy of the Account's email (not unique: one per business; the old unique index is dropped by migrateAccounts)
    phone: { type: String, trim: true },
    password: { type: String, select: false }, // legacy (before Accounts); the login password lives on the Account
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    lastAssignedAt: { type: Date, default: () => new Date(0) }, // used by round-robin assignment
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    return ret;
  },
});

export default mongoose.model('User', userSchema);
