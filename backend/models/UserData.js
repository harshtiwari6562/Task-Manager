import mongoose from 'mongoose';

const userDataSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    value: { type: String, required: true }, // JSON-stringified by the client
  },
  { timestamps: true }
);

userDataSchema.index({ userId: 1, key: 1 }, { unique: true });

export default mongoose.model('UserData', userDataSchema);
