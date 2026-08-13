import { island } from "@mandujs/core/client";
import { useState, useCallback } from "react";
import type { Category } from "../../shared/types";

interface CategoryManagerData {
  initialCategories: Category[];
}

const PRESET_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default island<CategoryManagerData>({
  setup: (serverData) => {
    const [categories, setCategories] = useState<Category[]>(serverData.initialCategories);
    const [newName, setNewName] = useState("");
    const [newColor, setNewColor] = useState(PRESET_COLORS[0]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [editColor, setEditColor] = useState("");

    const addCategory = useCallback(async () => {
      if (!newName.trim()) return;
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      const { category } = await res.json();
      setCategories((prev) => [...prev, category]);
      setNewName("");
      setNewColor(PRESET_COLORS[(categories.length + 1) % PRESET_COLORS.length]);
    }, [newName, newColor, categories.length]);

    const startEdit = useCallback((cat: Category) => {
      setEditingId(cat.id);
      setEditName(cat.name);
      setEditColor(cat.color);
    }, []);

    const saveEdit = useCallback(async () => {
      if (!editingId || !editName.trim()) return;
      const res = await fetch(`/api/categories/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      const { category } = await res.json();
      setCategories((prev) => prev.map((c) => (c.id === editingId ? category : c)));
      setEditingId(null);
    }, [editingId, editName, editColor]);

    const cancelEdit = useCallback(() => setEditingId(null), []);

    const deleteCategory = useCallback(async (id: string) => {
      await fetch(`/api/categories/${id}`, { method: "DELETE" });
      setCategories((prev) => prev.filter((c) => c.id !== id));
      if (editingId === id) setEditingId(null);
    }, [editingId]);

    return {
      categories, newName, newColor, editingId, editName, editColor,
      setNewName, setNewColor, setEditName, setEditColor,
      addCategory, startEdit, saveEdit, cancelEdit, deleteCategory,
    };
  },

  render: (ctx) => {
    const {
      categories, newName, newColor, editingId, editName, editColor,
      setNewName, setNewColor, setEditName, setEditColor,
      addCategory, startEdit, saveEdit, cancelEdit, deleteCategory,
    } = ctx;

    return (
      <div>
        <h1
          className="text-4xl mb-1"
          style={{ fontFamily: 'var(--font-display)', fontStyle: 'italic' }}
        >
          Categories
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--color-ink-muted)' }}>
          {categories.length} categories to organize your work
        </p>
        {/* Add form */}
        <form
          onSubmit={(e) => { e.preventDefault(); addCategory(); }}
          className="card p-5 mb-6"
        >
          <div className="flex gap-3 mb-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Category name"
              className="input-warm flex-1"
            />
            <button type="submit" className="btn-primary">Add</button>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>Color:</span>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNewColor(c)}
                className={`color-dot ${newColor === c ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </form>

        {/* Category list */}
        {categories.length === 0 ? (
          <div className="card p-10 text-center">
            <div className="text-3xl mb-3">🏷️</div>
            <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>No categories yet. Create one above!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {categories.map((cat) => (
              <div key={cat.id} className="card p-4 group">
                {editingId === cat.id ? (
                  <div>
                    <div className="flex gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-semibold shrink-0"
                        style={{ backgroundColor: editColor }}
                      >
                        {editName.charAt(0) || "?"}
                      </div>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="input-warm flex-1"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2 items-center mb-3">
                      <span className="text-xs font-medium" style={{ color: 'var(--color-ink-muted)' }}>Color:</span>
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setEditColor(c)}
                          className={`color-dot ${editColor === c ? 'selected' : ''}`}
                          style={{ backgroundColor: c, width: '24px', height: '24px' }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="btn-primary" style={{ padding: '6px 16px', fontSize: '13px' }}>Save</button>
                      <button onClick={cancelEdit} className="btn-secondary" style={{ padding: '6px 16px', fontSize: '13px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-sm font-semibold shrink-0"
                      style={{ backgroundColor: cat.color }}
                    >
                      {cat.name.charAt(0)}
                    </div>
                    <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{cat.name}</span>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(cat)}
                        className="text-xs font-medium px-3 py-1 rounded-lg transition-colors"
                        style={{ color: 'var(--color-teal)', background: 'var(--color-teal-light)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteCategory(cat.id)}
                        className="text-xs font-medium px-3 py-1 rounded-lg transition-colors"
                        style={{ color: 'var(--color-terracotta)', background: 'var(--color-terracotta-light)' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
});
