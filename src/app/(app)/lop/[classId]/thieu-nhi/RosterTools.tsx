"use client";
import { FileUp, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { ImportCsv } from "./ImportCsv";
import { StudentForm } from "./StudentForm";

type Panel = "add" | "csv" | null;

/** Hai công cụ thêm thiếu nhi, mở một cái một lúc để danh sách luôn là nội dung chính. */
export function RosterTools({ classId }: { classId: string }) {
  const [open, setOpen] = useState<Panel>(null);
  const toggle = (p: Exclude<Panel, null>) => setOpen((cur) => (cur === p ? null : p));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-expanded={open === "add"} onClick={() => toggle("add")}
          className={`btn ${open === "add" ? "btn-secondary" : "btn-primary"}`}>
          {open === "add" ? <X aria-hidden size={20} /> : <UserPlus aria-hidden size={20} />}
          {open === "add" ? "Đóng" : "Thêm em"}
        </button>
        <button type="button" aria-expanded={open === "csv"} onClick={() => toggle("csv")} className="btn btn-secondary">
          {open === "csv" ? <X aria-hidden size={20} /> : <FileUp aria-hidden size={20} />}
          {open === "csv" ? "Đóng" : "Nhập CSV"}
        </button>
      </div>
      {open === "add" && <StudentForm classId={classId} />}
      {open === "csv" && <ImportCsv classId={classId} />}
    </div>
  );
}
