// src/pages/ManageDepartments.tsx
import React, { useState, useEffect } from "react";
import { Card, Button, Input } from "../components/Common";
import { Plus, Trash, Edit } from "lucide-react";
import apiClient from "../services/apiClient";
import { useApp } from "../store";

const ManageDepartments: React.FC = () => {
  const {
    departments = [],
    addDepartment,
    updateDepartment,
    deleteDepartment,
    fetchDepartments,
  } = useApp();

  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    if (!departments.length) {
      void fetchDepartments(false, controller.signal);
    }
    return () => {
      controller.abort();
    };
  }, [fetchDepartments, departments.length]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const newName = name.trim();
    const newCode = code.trim();
    if (!newName || !newCode) return;

    // Reset inputs immediately for instant feedback
    setName("");
    setCode("");
    setShowAdd(false);
    setLoading(true);

    const res = await addDepartment({
      name: newName,
      code: newCode,
    });

    if (!res?.ok) {
      alert(res?.error || "Failed to create department");
      setName(newName);
      setCode(newCode);
      setShowAdd(true);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this department?")) return;
    setLoading(true);

    const res = await deleteDepartment(id);
    if (!res?.ok) {
      alert(res?.error || "Failed to delete department");
    }

    setLoading(false);
  };

  const startEdit = (d: any) => {
    setEditingId(d._id || d.id);
    setEditName(d.name || "");
    setEditCode(d.code || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditCode("");
  };

  const saveEdit = async (id: string) => {
    const nextName = editName.trim();
    const nextCode = editCode.trim();
    if (!nextName || !nextCode) return alert("Please provide name and code");

    cancelEdit();
    setLoading(true);

    const res = await updateDepartment(id, {
      name: nextName,
      code: nextCode,
    });

    if (!res?.ok) {
      alert(res?.error || "Failed to update department");
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">Departments</h2>
        <Button onClick={() => setShowAdd((v) => !v)}>
          <Plus size={16} /> Add Department
        </Button>
      </div>

      {showAdd && (
        <Card className="bg-blue-50 border-blue-200">
          <form onSubmit={handleAdd} className="space-y-3">
            <Input
              placeholder="Department Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              placeholder="Department Code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </form>
        </Card>
      )}

      <Card>
        <ul className="space-y-3">
          {departments.length === 0 && (
            <li className="text-sm text-slate-500">No departments found.</li>
          )}

          {departments.map((d: any) => {
            const id = d._id || d.id;
            return (
              <li
                key={id}
                className="flex justify-between items-center bg-slate-50 border border-slate-200 p-3 rounded-lg"
              >
                {editingId === id ? (
                  <div className="flex w-full items-center gap-2">
                    <input className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" value={editName} onChange={(e) => setEditName(e.target.value)} />
                    <input className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" value={editCode} onChange={(e) => setEditCode(e.target.value)} />
                    <div className="flex gap-2">
                      <button className="rounded-md bg-emerald-600 px-2 py-1 text-white text-sm" onClick={() => saveEdit(id)} disabled={loading}>Save</button>
                      <button className="rounded-md border px-2 py-1 text-sm" onClick={cancelEdit}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="font-medium text-slate-800">
                      {d.name}
                      <span className="text-xs text-slate-500 ml-2">({d.code || "—"})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="p-2 text-slate-700 hover:bg-slate-50 rounded-lg" onClick={() => startEdit(d)}>
                        <Edit size={16} />
                      </button>
                      <button
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        onClick={() => handleDelete(id)}
                        disabled={loading}
                      >
                        <Trash size={16} />
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
};

export default ManageDepartments;
