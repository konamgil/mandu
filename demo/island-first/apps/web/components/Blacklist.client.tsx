import { island } from "@mandujs/core/client";
import React, { useState, useCallback, useEffect } from "react";

interface BlacklistRecord {
  id: number;
  name: string;
  phone: string;
  carModel: string;
  plateNumber: string;
  rentalDate: string;
  amountOwed: number;
  status: "stolen" | "unpaid";
  notes: string;
  createdAt: string;
}

interface BlacklistData {
  title: string;
  description: string;
}

const STATUS_LABELS: Record<string, string> = {
  all: "전체",
  stolen: "도난",
  unpaid: "미납",
};

const EMPTY_FORM = {
  name: "",
  phone: "",
  carModel: "",
  plateNumber: "",
  rentalDate: "",
  amountOwed: 0,
  status: "unpaid" as "stolen" | "unpaid",
  notes: "",
};

export default island<BlacklistData>({
  setup: (serverData) => {
    const [records, setRecords] = useState<BlacklistRecord[]>([]);
    const [statusFilter, setStatusFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({ ...EMPTY_FORM });
    const [loading, setLoading] = useState(false);

    const fetchRecords = useCallback(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (search) params.set("search", search);
        const res = await fetch(`/api/blacklist?${params}`);
        const data = await res.json();
        setRecords(data.records || []);
      } finally {
        setLoading(false);
      }
    }, [statusFilter, search]);

    useEffect(() => {
      fetchRecords();
    }, [fetchRecords]);

    const handleAdd = useCallback(async () => {
      const res = await fetch("/api/blacklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          amountOwed: Number(form.amountOwed),
        }),
      });
      if (res.ok) {
        setForm({ ...EMPTY_FORM });
        setShowForm(false);
        fetchRecords();
      }
    }, [form, fetchRecords]);

    const handleDelete = useCallback(
      async (id: number) => {
        const res = await fetch(`/api/blacklist?id=${id}`, {
          method: "DELETE",
        });
        if (res.ok) {
          fetchRecords();
        }
      },
      [fetchRecords]
    );

    const updateForm = useCallback(
      (field: string, value: string | number) => {
        setForm((prev) => ({ ...prev, [field]: value }));
      },
      []
    );

    return {
      title: serverData.title,
      description: serverData.description,
      records,
      statusFilter,
      setStatusFilter,
      search,
      setSearch,
      showForm,
      setShowForm,
      form,
      updateForm,
      handleAdd,
      handleDelete,
      loading,
    };
  },

  render: ({
    title,
    description,
    records,
    statusFilter,
    setStatusFilter,
    search,
    setSearch,
    showForm,
    setShowForm,
    form,
    updateForm,
    handleAdd,
    handleDelete,
    loading,
  }) =>
    React.createElement(
      "div",
      { className: "blacklist-island" },

      // Header
      React.createElement(
        "div",
        { className: "bl-header" },
        React.createElement("h2", null, title),
        React.createElement("p", { className: "bl-desc" }, description)
      ),

      // Toolbar: filter + search + add button
      React.createElement(
        "div",
        { className: "bl-toolbar" },
        React.createElement(
          "div",
          { className: "bl-filters" },
          ...["all", "stolen", "unpaid"].map((s) =>
            React.createElement(
              "button",
              {
                key: s,
                className: `bl-filter-btn${statusFilter === s ? " active" : ""}`,
                onClick: () => setStatusFilter(s),
              },
              STATUS_LABELS[s]
            )
          )
        ),
        React.createElement("input", {
          className: "bl-search",
          type: "text",
          placeholder: "이름, 전화번호, 차량번호 검색",
          value: search,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value),
        }),
        React.createElement(
          "button",
          {
            className: "bl-add-btn",
            onClick: () => setShowForm(!showForm),
          },
          showForm ? "취소" : "+ 등록"
        )
      ),

      // Add Form
      showForm
        ? React.createElement(
            "div",
            { className: "bl-form" },
            React.createElement(
              "div",
              { className: "bl-form-grid" },
              React.createElement("input", {
                placeholder: "이름 *",
                value: form.name,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("name", e.target.value),
              }),
              React.createElement("input", {
                placeholder: "전화번호 *",
                value: form.phone,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("phone", e.target.value),
              }),
              React.createElement("input", {
                placeholder: "차량 모델 *",
                value: form.carModel,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("carModel", e.target.value),
              }),
              React.createElement("input", {
                placeholder: "차량 번호 *",
                value: form.plateNumber,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("plateNumber", e.target.value),
              }),
              React.createElement("input", {
                type: "date",
                value: form.rentalDate,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("rentalDate", e.target.value),
              }),
              React.createElement("input", {
                type: "number",
                placeholder: "미납금액",
                value: form.amountOwed,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("amountOwed", e.target.value),
              }),
              React.createElement(
                "select",
                {
                  value: form.status,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                    updateForm("status", e.target.value),
                },
                React.createElement("option", { value: "unpaid" }, "미납"),
                React.createElement("option", { value: "stolen" }, "도난")
              ),
              React.createElement("input", {
                placeholder: "비고",
                value: form.notes,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  updateForm("notes", e.target.value),
              })
            ),
            React.createElement(
              "button",
              { className: "bl-submit-btn", onClick: handleAdd },
              "등록"
            )
          )
        : null,

      // Table
      loading
        ? React.createElement("p", { className: "bl-loading" }, "로딩 중...")
        : records.length === 0
          ? React.createElement(
              "p",
              { className: "bl-empty" },
              "등록된 블랙리스트가 없습니다."
            )
          : React.createElement(
              "table",
              { className: "bl-table" },
              React.createElement(
                "thead",
                null,
                React.createElement(
                  "tr",
                  null,
                  React.createElement("th", null, "이름"),
                  React.createElement("th", null, "전화번호"),
                  React.createElement("th", null, "차량"),
                  React.createElement("th", null, "차량번호"),
                  React.createElement("th", null, "대여일"),
                  React.createElement("th", null, "미납금액"),
                  React.createElement("th", null, "상태"),
                  React.createElement("th", null, "비고"),
                  React.createElement("th", null, "")
                )
              ),
              React.createElement(
                "tbody",
                null,
                ...records.map((r) =>
                  React.createElement(
                    "tr",
                    { key: r.id },
                    React.createElement("td", null, r.name),
                    React.createElement("td", null, r.phone),
                    React.createElement("td", null, r.carModel),
                    React.createElement("td", null, r.plateNumber),
                    React.createElement("td", null, r.rentalDate),
                    React.createElement(
                      "td",
                      null,
                      r.amountOwed > 0
                        ? `${r.amountOwed.toLocaleString()}원`
                        : "-"
                    ),
                    React.createElement(
                      "td",
                      null,
                      React.createElement(
                        "span",
                        {
                          className: `bl-status bl-status-${r.status}`,
                        },
                        r.status === "stolen" ? "도난" : "미납"
                      )
                    ),
                    React.createElement("td", null, r.notes),
                    React.createElement(
                      "td",
                      null,
                      React.createElement(
                        "button",
                        {
                          className: "bl-delete-btn",
                          onClick: () => handleDelete(r.id),
                        },
                        "삭제"
                      )
                    )
                  )
                )
              )
            ),

      // Style
      React.createElement("style", null, `
        .blacklist-island {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          max-width: 960px;
          margin: 0 auto;
          padding: 24px 16px;
          color: #1a1a2e;
        }
        .bl-header { margin-bottom: 24px; }
        .bl-header h2 { margin: 0 0 4px; font-size: 1.5rem; }
        .bl-desc { margin: 0; color: #666; font-size: 0.9rem; }
        .bl-toolbar {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }
        .bl-filters { display: flex; gap: 4px; }
        .bl-filter-btn {
          padding: 6px 14px;
          border: 1px solid #ddd;
          border-radius: 6px;
          background: #fff;
          cursor: pointer;
          font-size: 0.85rem;
        }
        .bl-filter-btn.active {
          background: #1a1a2e;
          color: #fff;
          border-color: #1a1a2e;
        }
        .bl-search {
          flex: 1;
          min-width: 180px;
          padding: 8px 12px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 0.85rem;
        }
        .bl-add-btn {
          padding: 8px 16px;
          background: #2563eb;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 0.85rem;
          font-weight: 500;
        }
        .bl-form {
          background: #f8f9fa;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }
        .bl-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }
        .bl-form-grid input,
        .bl-form-grid select {
          padding: 8px 10px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-size: 0.85rem;
        }
        .bl-submit-btn {
          padding: 8px 24px;
          background: #16a34a;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
        }
        .bl-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.85rem;
        }
        .bl-table th {
          text-align: left;
          padding: 10px 8px;
          border-bottom: 2px solid #e5e7eb;
          color: #6b7280;
          font-weight: 600;
          font-size: 0.8rem;
        }
        .bl-table td {
          padding: 10px 8px;
          border-bottom: 1px solid #f3f4f6;
        }
        .bl-table tr:hover td { background: #f9fafb; }
        .bl-status {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .bl-status-stolen { background: #fee2e2; color: #dc2626; }
        .bl-status-unpaid { background: #fef3c7; color: #d97706; }
        .bl-delete-btn {
          padding: 4px 10px;
          background: #ef4444;
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 0.75rem;
        }
        .bl-loading, .bl-empty {
          text-align: center;
          color: #9ca3af;
          padding: 32px 0;
        }
      `)
    ),
});
