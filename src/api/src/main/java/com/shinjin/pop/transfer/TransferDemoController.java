package com.shinjin.pop.transfer;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import synthetic.transfer.InMemoryTransferDomain;
import synthetic.transfer.TransferDomain.*;

import java.math.BigDecimal;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/transfers")
public class TransferDemoController {
    private static final System.Logger LOG = System.getLogger(TransferDemoController.class.getName());
    private static final String SOURCE = "BIN-SOURCE";
    private static final String DESTINATION = "BIN-DEST";
    private final Map<String, FactoryTransfers> factories = new ConcurrentHashMap<>();

    public record Actor(String terminalId, String workerId) {}
    public record Stock(String warehouse, String item, String quantity) {}
    public record ReplayLine(int number, String item, String quantity) {}
    public record ReplayDraft(String source, String destination, List<ReplayLine> lines) {}
    public record ReplayCommand(String request, String commandId, Action action, ReplayDraft draft) {}
    public record Pending(String request, boolean canRetry, ReplayCommand command) {}
    public record State(Actor actor, String source, String destination, List<Stock> stock,
                        List<Transfer> transfers, List<Document> documents, List<Pending> pending) {}
    public record CommandBody(Command command, Boolean simulatePopFailure) {}
    public record Result(String code, Transfer transfer, Actor actor) {}
    public record Failure(String code) {}

    private record CommandKey(String request, String commandId) {}

    private static final class FactoryTransfers {
        final InMemoryTransferDomain domain = new InMemoryTransferDomain(Map.of(
                new StockKey(SOURCE, "SKU-X"), new BigDecimal("5.000"),
                new StockKey(SOURCE, "SKU-Y"), new BigDecimal("2.000"),
                new StockKey(DESTINATION, "SKU-X"), BigDecimal.ZERO,
                new StockKey(DESTINATION, "SKU-Y"), BigDecimal.ZERO));
        final Map<CommandKey, Actor> actors = new HashMap<>();
    }

    @GetMapping
    public ResponseEntity<State> get(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        Actor actor = actor(identity);
        FactoryTransfers factory = factory(identity);
        synchronized (factory) {
            View view = factory.domain.view();
            var stock = view.stock().entrySet().stream()
                    .map(entry -> new Stock(entry.getKey().warehouse(), entry.getKey().item(),
                            entry.getValue().toPlainString()))
                    .sorted(Comparator.comparing(Stock::warehouse).thenComparing(Stock::item)).toList();
            var transfers = view.transfers().values().stream()
                    .sorted(Comparator.comparing(Transfer::request)).toList();
            var documents = view.activeErpDocuments().values().stream()
                    .sorted(Comparator.comparingLong(document -> document.id().revision())).toList();
            var pending = view.pending().values().stream().sorted(Comparator.comparing(Command::request))
                    .map(command -> {
                        boolean canRetry = actor.equals(factory.actors.get(key(command)));
                        return new Pending(command.request(), canRetry, canRetry ? replay(command) : null);
                    }).toList();
            return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                    .body(new State(actor, SOURCE, DESTINATION, stock, transfers, documents, pending));
        }
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<Result> command(@RequestBody CommandBody body, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        Actor actor = actor(identity);
        if (body == null || body.command() == null) return result(Code.INVALID_COMMAND, null, actor);
        Command command = body.command();
        FactoryTransfers factory = factory(identity);
        synchronized (factory) {
            CommandKey key = key(command);
            Actor original = factory.actors.get(key);
            if (original != null && !actor.equals(original)) {
                return ResponseEntity.status(403).body(new Result("COMMAND_ACTOR_MISMATCH", null, actor));
            }
            if (command.draft() != null && (!SOURCE.equals(command.draft().source())
                    || !DESTINATION.equals(command.draft().destination())
                    || command.draft().lines().stream().anyMatch(line ->
                            !"SKU-X".equals(line.item()) && !"SKU-Y".equals(line.item())))) {
                return result(Code.INVALID_LINES, null, actor);
            }
            var fault = Boolean.TRUE.equals(body.simulatePopFailure()) && original == null
                    ? InMemoryTransferDomain.Fault.AFTER_ERP_COMMIT : InMemoryTransferDomain.Fault.NONE;
            Reply reply = factory.domain.execute(command, fault);
            if (reply.code() == Code.OK || reply.code() == Code.ERP_COMMITTED_POP_PENDING) {
                factory.actors.putIfAbsent(key, actor);
            }
            return result(reply.code(), reply.transfer(), actor);
        }
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Failure> malformed() {
        return ResponseEntity.badRequest().body(new Failure("MALFORMED_COMMAND"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Failure> sessionError(ResponseStatusException exception) {
        return ResponseEntity.status(exception.getStatusCode())
                .body(new Failure(exception.getStatusCode().value() == 401 ? "LOGIN_REQUIRED" : "REQUEST_FAILED"));
    }

    @ExceptionHandler(RuntimeException.class)
    public ResponseEntity<Failure> unexpected(RuntimeException exception) {
        LOG.log(System.Logger.Level.ERROR, "Unexpected transfer demo failure", exception);
        return ResponseEntity.internalServerError().body(new Failure("INTERNAL_ERROR"));
    }

    private FactoryTransfers factory(DemoSessionController.Identity identity) {
        return factories.computeIfAbsent(identity.terminal().factory(), unused -> new FactoryTransfers());
    }

    private static Actor actor(DemoSessionController.Identity identity) {
        return new Actor(identity.terminal().id(), identity.worker().id());
    }

    private static ReplayCommand replay(Command command) {
        Draft draft = command.draft();
        ReplayDraft copy = draft == null ? null : new ReplayDraft(draft.source(), draft.destination(),
                draft.lines().stream().map(line -> new ReplayLine(line.number(), line.item(),
                        line.quantity().toPlainString())).toList());
        return new ReplayCommand(command.request(), command.commandId(), command.action(), copy);
    }

    private static CommandKey key(Command command) {
        return new CommandKey(command.request(), command.commandId());
    }

    private static ResponseEntity<Result> result(Code code, Transfer transfer, Actor actor) {
        int status = switch (code) {
            case OK -> 200;
            case INVALID_COMMAND -> 400;
            case REQUEST_NOT_FOUND -> 404;
            case INVALID_STATE, REQUEST_ID_REUSED, RECONCILIATION_REQUIRED, ERP_DETAIL_MISMATCH, INSUFFICIENT_STOCK, STOCK_OVERFLOW -> 409;
            case INVALID_LINES -> 422;
            case ERP_COMMITTED_POP_PENDING -> 503;
            case FAILED_BEFORE_ERP_COMMIT -> 500;
        };
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
                .body(new Result(code.name(), transfer, actor));
    }
}
