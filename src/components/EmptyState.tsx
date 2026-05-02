import { Link } from "react-router-dom";
import { Upload } from "lucide-react";

export function EmptyState() {
  return (
    <div className="card card-pad flex flex-col items-center justify-center text-center py-16 gap-4">
      <Upload className="w-12 h-12 text-muted" />
      <div>
        <div className="text-lg font-semibold mb-1">Нет данных</div>
        <div className="text-sm text-muted mb-4">
          Загрузите CSV-выгрузку из Дзен-мани, чтобы увидеть аналитику
        </div>
      </div>
      <Link to="/import" className="btn-primary">
        Загрузить CSV
      </Link>
    </div>
  );
}
