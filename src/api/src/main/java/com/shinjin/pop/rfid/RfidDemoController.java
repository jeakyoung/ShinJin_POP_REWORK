package com.shinjin.pop.rfid;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
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

    public record PhotoEvent(String eventId, String kind, String pallet, String tag, boolean readOnly,
                             int revision, List<String> samples) {}
    public record AttachPhoto(String requestId, String sampleId, Integer revision, Boolean confirmed) {}
    public record PhotoReply(String code, PhotoEvent event) {}
    private record PhotoReceipt(Actor actor, String eventId, AttachPhoto command) {}
    private static final String FIXTURE_EVENT = "PHOTO-HISTORY-01";
    private static final Set<String> SAMPLES = Set.of("grid", "stripes");

    @GetMapping("/photos")
    public ResponseEntity<List<PhotoEvent>> photoEvents(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(workspace(identity).photoEvents(actor(identity)));
    }

    @PostMapping(path = "/photos/events/{eventId}", consumes = "application/json")
    public ResponseEntity<PhotoReply> attachPhoto(@PathVariable("eventId") String eventId,
                                                   @RequestBody AttachPhoto command, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return workspace(identity).attachPhoto(actor(identity), eventId, command);
    }

    @GetMapping(value = "/photos/samples/{sampleId}", produces = "image/png")
    public ResponseEntity<Resource> photoSample(
            @PathVariable("sampleId") String sampleId, HttpServletRequest request) {
        DemoSessionController.requireIdentity(request);
        if (!SAMPLES.contains(sampleId)) return ResponseEntity.notFound().build();
        var resource = new ClassPathResource("rfid-samples/" + sampleId + ".png");
        if (!resource.exists()) return ResponseEntity.notFound().build();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(resource);
    }

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

        private record Photos(Map<String, PhotoEvent> attachments, Map<String, PhotoReceipt> receipts) {}
        private Photos photos = new Photos(Map.of(), Map.of());

        synchronized List<PhotoEvent> photoEvents(Actor actor) {
            var results = new ArrayList<PhotoEvent>();
            if (actor.equals(new Actor("DEMO-A", "DEMO-W01"))) {
                results.add(new PhotoEvent(FIXTURE_EVENT, "PALLET_CONFIRMATION", "SAMPLE-PALLET", "SAMPLE-TAG",
                        true, 0, List.of("grid", "stripes")));
            }
            for (Movement row : view(actor).history()) {
                results.add(photos.attachments().getOrDefault(row.eventId(),
                        new PhotoEvent(row.eventId(), row.direction(), row.pallet(), row.tag(), false, 0, List.of())));
            }
            return List.copyOf(results);
        }

        synchronized ResponseEntity<PhotoReply> attachPhoto(Actor actor, String eventId, AttachPhoto command) {
            var event = photoEvents(actor).stream().filter(row -> row.eventId().equals(eventId)).findFirst().orElse(null);
            if (event == null) return photoAnswer(404, "PHOTO_EVENT_NOT_FOUND", null);
            if (event.readOnly()) return photoAnswer(409, "PHOTO_READ_ONLY", event);
            if (clean(command.requestId()).isEmpty() || command.revision() == null || command.revision() < 0) {
                return photoAnswer(400, "INVALID_PHOTO_COMMAND", event);
            }
            var normalized = new AttachPhoto(clean(command.requestId()), clean(command.sampleId()),
                    command.revision(), command.confirmed());
            var prior = photos.receipts().get(normalized.requestId());
            if (prior != null) {
                if (prior.actor().equals(actor) && prior.eventId().equals(eventId) && prior.command().equals(normalized)) {
                    return photoAnswer(200, "PHOTO_REPLAYED", event);
                }
                return photoAnswer(409, "PHOTO_REQUEST_REUSED", event);
            }
            if (!Boolean.TRUE.equals(normalized.confirmed())) return photoAnswer(409, "PHOTO_CONFIRM_REQUIRED", event);
            if (!SAMPLES.contains(normalized.sampleId()) ||
                    !new ClassPathResource("rfid-samples/" + normalized.sampleId() + ".png").exists()) {
                return photoAnswer(400, "PHOTO_SAMPLE_UNAVAILABLE", event);
            }
            if (event.samples().contains(normalized.sampleId())) return photoAnswer(409, "PHOTO_ALREADY_ATTACHED", event);
            if (normalized.revision() != event.revision()) return photoAnswer(409, "STALE_PHOTO_REVISION", event);

            var samples = new ArrayList<>(event.samples());
            samples.add(normalized.sampleId());
            var result = new PhotoEvent(eventId, event.kind(), event.pallet(), event.tag(), false,
                    event.revision() + 1, List.copyOf(samples));
            var attachments = new HashMap<>(photos.attachments());
            var receipts = new HashMap<>(photos.receipts());
            attachments.put(eventId, result);
            receipts.put(normalized.requestId(), new PhotoReceipt(actor, eventId, normalized));
            photos = new Photos(Map.copyOf(attachments), Map.copyOf(receipts));
            return photoAnswer(200, "PHOTO_ATTACHED", result);
        }

        private static ResponseEntity<PhotoReply> photoAnswer(int status, String code, PhotoEvent event) {
            return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(new PhotoReply(code, event));
        }

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
            if (command.eventId().isEmpty() || command.eventId().equals(FIXTURE_EVENT)) return answer(actor, 400, "INVALID_INPUT");
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
