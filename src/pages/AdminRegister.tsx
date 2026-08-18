// src/pages/AdminRegister.tsx
import React, { useState } from "react";
import { Button, Card, Input } from "../components/Common";
import { useApp, View } from "../store";
import { ArrowLeft, Shield } from "lucide-react";
import apiClient from "../services/apiClient";

const AdminRegister: React.FC = () => {
  const { navigateTo } = useApp();

  const [form, setForm] = useState({
    name: "",
    collegeName: "",
    email: "",
    password: "",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiClient.createAdmin({
        name: form.name.trim(),
        collegeName: form.collegeName.trim(),
        email: form.email.trim(),
        password: form.password,
      });

      setLoading(false);

      if (!res?.ok) {
        setError(res?.error || "Admin registration failed");
        return;
      }

      navigateTo(View.LOGIN);
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || "Network error");
    }
  };

  return (
    <div className="max-w-lg mx-auto mt-10">
      <button
        onClick={() => navigateTo(View.LOGIN)}
        className="flex items-center gap-2 mb-4 text-slate-600 hover:text-slate-800"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <Card className="p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-3">
            <Shield size={32} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">
            Register Admin
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Create your institution’s primary administrator account.
          </p>
        </div>

        {error && (
          <div className="text-red-600 text-sm mb-4 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Full name"
            value={form.name}
            onChange={(e) =>
              setForm({ ...form, name: e.target.value })
            }
            required
          />

          <Input
            label="College / Institution"
            value={form.collegeName}
            onChange={(e) =>
              setForm({ ...form, collegeName: e.target.value })
            }
            required
          />

          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) =>
              setForm({ ...form, email: e.target.value })
            }
            required
          />

          <Input
            label="Password"
            type="password"
            value={form.password}
            onChange={(e) =>
              setForm({ ...form, password: e.target.value })
            }
            required
          />

          <Button
            type="submit"
            className="w-full py-3"
            disabled={loading}
          >
            {loading ? "Creating..." : "Create Admin"}
          </Button>
        </form>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => navigateTo(View.LOGIN)}
            className="text-sm font-medium text-slate-600 underline underline-offset-4 transition-colors hover:text-slate-900"
          >
            Move to Login
          </button>
        </div>
      </Card>
    </div>
  );
};

export default AdminRegister;
