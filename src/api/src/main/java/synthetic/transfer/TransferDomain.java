package synthetic.transfer;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

public interface TransferDomain {
    enum Action { REQUEST, QUICK_TRANSFER, SHIP, RECEIVE, UNDO_RECEIVE, UNDO_SHIP, CANCEL_REQUEST }
    enum Status { REQUESTED, SHIPPED, RECEIVED, CANCELLED }
    enum Kind { REQUEST, SHIP, RECEIVE }
    enum Code {
        OK, INVALID_COMMAND, INVALID_LINES, REQUEST_NOT_FOUND, INVALID_STATE, REQUEST_ID_REUSED,
        RECONCILIATION_REQUIRED, ERP_DETAIL_MISMATCH, INSUFFICIENT_STOCK, STOCK_OVERFLOW,
        FAILED_BEFORE_ERP_COMMIT, ERP_COMMITTED_POP_PENDING
    }

    record StockKey(String warehouse, String item) {}
    record Line(int number, String item, BigDecimal quantity) {
        public Line {
            if (quantity != null) {
                try {
                    quantity = quantity.setScale(3, RoundingMode.UNNECESSARY);
                } catch (ArithmeticException ignored) {
                    // Leave excess precision for the command validator to reject.
                }
            }
        }
    }
    record Draft(String source, String destination, List<Line> lines) {
        public Draft {
            lines = lines == null ? List.of() : List.copyOf(lines).stream()
                    .sorted(Comparator.comparingInt(Line::number)).toList();
        }
    }
    record Command(String request, String commandId, Action action, Draft draft) {}
    record DocumentId(String request, Kind kind, long revision) {}
    record DocumentLine(Line line, DocumentId sourceDocument, Integer sourceLine) {}
    record Document(DocumentId id, List<DocumentLine> lines) {
        public Document {
            lines = List.copyOf(lines).stream()
                    .sorted(Comparator.comparingInt(row -> row.line().number())).toList();
        }
    }
    record Transfer(String request, Status status, Draft draft, Map<Kind, DocumentId> documents) {
        public Transfer { documents = Map.copyOf(documents); }
    }
    record Reply(Code code, Transfer transfer) {}
    record View(Map<String, Transfer> transfers, Map<StockKey, BigDecimal> stock,
                Map<DocumentId, Document> activeErpDocuments, Map<String, Command> pending) {
        public View {
            transfers = Map.copyOf(transfers);
            stock = Map.copyOf(stock);
            activeErpDocuments = Map.copyOf(activeErpDocuments);
            pending = Map.copyOf(pending);
        }
    }

    Reply execute(Command command);
    View view();
}
