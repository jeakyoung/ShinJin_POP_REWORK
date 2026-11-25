package com.shinjin.pop.rfid;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Profile("demo")
@RestController
@RequestMapping("/api/pop/rfid")
public class RfidDemoController {
    public record Actor(String terminal, String worker) {}
    public record Command(String eventId, String action, String tag, String pallet, String item) {
        Command normalized() {
            return new Command(clean(eventId), clean(action), clean(tag), clean(pallet), clean(item));
        }
    }
    public record Pallet(Actor owner, String tag, List<String> items, boolean inside) {}
    public record Movement(String eventId, String direction, String pallet, String tag, List<String> items) {}
    public record View(List<Movement> history, int netInventoryDelta) {}
    public record Reply(String code, View view) {}
    private record Receipt(Actor actor, Command command) {}
    private record State(Map<String, Actor> tags, Map<String, Pallet> pallets,
                         List<Movement> history, Map<String, Receipt> receipts) {}

    private final Map<String, Workspace> factories = new ConcurrentHashMap<>();

    @GetMapping
    public ResponseEntity<View> view(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(workspace(identity).view(actor(identity)));
    }

    @PostMapping(path = "/commands", consumes = "application/json")
    public ResponseEntity<Reply> apply(@RequestBody Command command, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return workspace(identity).apply(actor(identity), command.normalized());
    }

    private Workspace workspace(DemoSessionController.Identity identity) {
        return factories.computeIfAbsent(identity.terminal().factory(), key -> new Workspace());
    }

    private static Actor actor(DemoSessionController.Identity identity) {
        return new Actor(identity.terminal().id(), identity.worker().id());
    }

    static final class Workspace {
        private State state = new State(Map.of(), Map.of(), List.of(), Map.of());

        synchronized View view(Actor actor) {
            var movements = state.history().stream()
                    .filter(row -> state.pallets().get(row.pallet()).owner().equals(actor)).toList();
            int total = state.pallets().values().stream().filter(row -> row.inside() && row.owner().equals(actor))
                    .mapToInt(row -> row.items().size()).sum();
            return new View(movements, total);
        }

        synchronized ResponseEntity<Reply> apply(Actor actor, Command command) {
            return apply(actor, command, () -> {});
        }

        synchronized ResponseEntity<Reply> apply(Actor actor, Command command, Runnable beforeCommit) {
            if (command.eventId().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
            Receipt prior = state.receipts().get(command.eventId());
            if (prior != null) {
                if (!prior.actor().equals(actor)) return answer(actor, 403, "COMMAND_ACTOR_MISMATCH");
                return prior.command().equals(command) ? answer(actor, 200, "REPLAYED")
                        : answer(actor, 409, "EVENT_ID_REUSED");
            }

            var tags = new HashMap<>(state.tags());
            var pallets = new HashMap<>(state.pallets());
            var history = new ArrayList<>(state.history());
            String code;
            Pallet pallet = pallets.get(command.pallet());
            Actor tagOwner = tags.get(command.tag());
            switch (command.action()) {
                case "register" -> {
                    if (command.tag().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                    if (tagOwner != null) return answer(actor, 409, "ALREADY_REGISTERED");
                    tags.put(command.tag(), actor);
                    code = "REGISTERED";
                }
                case "match" -> {
                    if (command.tag().isEmpty() || command.pallet().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                    if (tagOwner == null) return answer(actor, 404, "TAG_NOT_FOUND");
                    if (!actor.equals(tagOwner)) return answer(actor, 403, "TAG_ACTOR_MISMATCH");
                    if (pallet != null || pallets.values().stream().anyMatch(row -> row.tag().equals(command.tag()))) {
                        return answer(actor, 409, "ALREADY_MATCHED");
                    }
                    pallets.put(command.pallet(), new Pallet(actor, command.tag(), List.of(), false));
                    code = "MATCHED";
                }
                case "load", "in", "out" -> {
                    if (command.pallet().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                    if (pallet == null) return answer(actor, 409, "INVALID_SEQUENCE");
                    if (!actor.equals(pallet.owner())) return answer(actor, 403, "PALLET_ACTOR_MISMATCH");
                    if (command.action().equals("load")) {
                        if (command.item().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                        if (pallet.inside()) return answer(actor, 409, "INVALID_SEQUENCE");
                        if (pallet.items().contains(command.item())) return answer(actor, 409, "ALREADY_LOADED");
                        var items = new ArrayList<>(pallet.items());
                        items.add(command.item());
                        pallets.put(command.pallet(), new Pallet(actor, pallet.tag(), List.copyOf(items), false));
                        code = "LOADED";
                    } else {
                        boolean entering = command.action().equals("in");
                        if (pallet.items().isEmpty() || pallet.inside() == entering) {
                            return answer(actor, 409, "INVALID_SEQUENCE");
                        }
                        pallets.put(command.pallet(), new Pallet(actor, pallet.tag(), pallet.items(), entering));
                        history.add(new Movement(command.eventId(), entering ? "IN" : "OUT",
                                command.pallet(), pallet.tag(), pallet.items()));
                        code = "APPLIED";
                    }
                }
                default -> { return answer(actor, 400, "INVALID_INPUT"); }
            }

            var receipts = new HashMap<>(state.receipts());
            receipts.put(command.eventId(), new Receipt(actor, command));
            var next = new State(Map.copyOf(tags), Map.copyOf(pallets), List.copyOf(history), Map.copyOf(receipts));
            beforeCommit.run();
            state = next;
            return answer(actor, 200, code);
        }

        private ResponseEntity<Reply> answer(Actor actor, int status, String code) {
            return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new Reply(code, view(actor)));
        }
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }
}
