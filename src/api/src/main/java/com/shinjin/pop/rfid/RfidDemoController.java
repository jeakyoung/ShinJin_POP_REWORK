package com.shinjin.pop.rfid;

import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.io.IOException;
import tools.jackson.databind.json.JsonMapper;
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
    public record Tag(String id, String code, boolean enabled, String worker, String registeredAt) {}
    public record TagInput(String id, String code, Boolean enabled) {}
    public record TagBatch(String requestId, String action, List<TagInput> rows) {}
    public record PalletMaster(String terminal, String worker, String number, String type, String status,
                               String made, String statusDate, String note, String registeredBy, String registeredAt) {}
    public record Customer(String terminal, String worker, String code, String name, String plan) {}
    public record Catalog(List<PalletMaster> pallets, List<Customer> customers) {}
    public record PalletEntry(String number, String tag, String tagCode, PalletMaster master) {}
    public record HistoryEntry(String eventId, String date, String time, String customer, String direction,
                               String pallet, String tagCode, String box, String number) {}
    public record Forms(String factory, String operator, String today, String from, String nextCode,
                        List<Tag> tags, List<PalletEntry> pallets, List<Customer> customers, List<HistoryEntry> history, List<Box> boxes) {}
    public record Box(String id, String date, String pallet, String tag, String tagCode, String customer, String picture,
                      String latestDirection) {}
    public record PackCommand(String requestId, String pallet, String tag, LocalDate date, String customer, List<String> pictures) {}
    public record MoveCommand(String requestId, String box, LocalDate date, String customer, String direction) {}
    private record Packet(Actor owner, PackCommand command, Box box, List<byte[]> images) {}
    private record ManualReceipt(Actor owner, MoveCommand command) {}
    private record BatchReceipt(Actor actor, TagBatch batch) {}
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

    @GetMapping("/forms")
    public ResponseEntity<Forms> forms(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(workspace(identity).forms(identity));
    }

    @PostMapping("/tags")
    public ResponseEntity<Reply> saveTags(@RequestBody TagBatch batch, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return workspace(identity).saveTags(actor(identity), batch);
    }

    @PostMapping("/boxes")
    public ResponseEntity<Reply> pack(@RequestBody PackCommand command, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return workspace(identity).pack(actor(identity), identity.terminal().factory(), command);
    }

    @PostMapping("/movements")
    public ResponseEntity<Reply> move(@RequestBody MoveCommand command, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return workspace(identity).manual(actor(identity), identity.terminal().factory(), command);
    }

    @GetMapping(value = "/boxes/{id}/picture", produces = "image/jpeg")
    public ResponseEntity<byte[]> picture(@PathVariable("id") String id, HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        return workspace(identity).picture(actor(identity), id);
    }

    private Workspace workspace(DemoSessionController.Identity identity) {
        return factories.computeIfAbsent(identity.terminal().factory(), key -> new Workspace());
    }

    private static Actor actor(DemoSessionController.Identity identity) {
        return new Actor(identity.terminal().id(), identity.worker().id());
    }

    static final class Workspace {
        private State state = new State(Map.of(), Map.of(), List.of(), Map.of());

        private final Map<String, Tag> tagDetails = new HashMap<>();
        private final Map<String, BatchReceipt> tagReceipts = new HashMap<>();
        private static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
        private static final DateTimeFormatter MONTH = DateTimeFormatter.ofPattern("yyMM");

        private static final Catalog CATALOG = loadCatalog();
        private final Map<String, HistoryEntry> movementDetails = new HashMap<>();

        private static Catalog loadCatalog() {
            try (var stream = new ClassPathResource("demo/rfid-forms.json").getInputStream()) {
                return JsonMapper.builder().build().readValue(stream, Catalog.class);
            } catch (IOException ex) { throw new IllegalStateException("RFID fixture unavailable", ex); }
        }

        private final Map<String, Packet> packets = new java.util.LinkedHashMap<>();
        private final Map<String, String> boxRequests = new HashMap<>();
        private final Map<String, ManualReceipt> manualReceipts = new HashMap<>();
        private final Map<String, String> lastDirections = new HashMap<>();

        private String nextTagCode() {
            String prefix = LocalDate.now(ZONE).format(MONTH);
            int max = tagDetails.values().stream().map(Tag::code).filter(code -> code.startsWith(prefix))
                    .mapToInt(code -> Integer.parseInt(code.substring(4))).max().orElse(0);
            return max >= 9999 ? "" : prefix + String.format("%04d", max + 1);
        }

        synchronized Forms forms(DemoSessionController.Identity identity) {
            Actor actor = actor(identity);
            LocalDate date = LocalDate.now(ZONE);
            var tags = tagDetails.values().stream().filter(tag -> actor.equals(state.tags().get(tag.id())))
                    .sorted(Comparator.comparing(Tag::code)).toList();
            var masters = new HashMap<String, PalletMaster>();
            var initialized = new HashMap<>(state.pallets());
            for (PalletMaster master : CATALOG.pallets()) {
                if (master.terminal().equals(actor.terminal()) && master.worker().equals(actor.worker())) {
                    masters.put(master.number(), master);
                    initialized.putIfAbsent(master.number(), new Pallet(actor, "", List.of(), false));
                }
            }
            if (initialized.size() != state.pallets().size()) {
                state = new State(state.tags(), Map.copyOf(initialized), state.history(), state.receipts());
            }
            var pallets = state.pallets().entrySet().stream().filter(entry -> entry.getValue().owner().equals(actor))
                    .map(entry -> {
                        String id = entry.getValue().tag();
                        return new PalletEntry(entry.getKey(), id, id.isEmpty() ? "" : tagDetails.get(id).code(), masters.get(entry.getKey()));
                    }).sorted(Comparator.comparing(PalletEntry::number)).toList();
            return new Forms(identity.terminal().factory(), identity.worker().name(), date.toString(),
                    date.minusMonths(1).toString(), nextTagCode(), tags, pallets,
                    CATALOG.customers().stream().filter(row -> row.terminal().equals(actor.terminal()) && row.worker().equals(actor.worker())).toList(),
                    view(actor).history().stream().map(row -> movementDetails.get(row.eventId())).toList(),
                    packets.values().stream().filter(row -> row.owner().equals(actor)).map(row -> {
                        Box b = row.box();
                        return new Box(b.id(), b.date(), b.pallet(), b.tag(), b.tagCode(), b.customer(),
                                b.picture(), lastDirections.getOrDefault(b.id(), ""));
                    }).toList());
        }

        private String customerName(Actor actor, String factory, String supplied) {
            if (factory.equals(supplied)) return factory;
            return CATALOG.customers().stream().filter(c -> c.terminal().equals(actor.terminal())
                    && c.worker().equals(actor.worker()) && c.code().equals(supplied)).map(Customer::name).findFirst().orElse(null);
        }

        synchronized ResponseEntity<Reply> pack(Actor actor, String factory, PackCommand cmd) {
            String key = clean(cmd.requestId());
            if (key.isEmpty() || cmd.date() == null || cmd.pictures() == null || cmd.pictures().isEmpty()) {
                return answer(actor, 400, "MISSING_PHOTO");
            }
            Packet prior = packets.get(boxRequests.get(key));
            if (prior != null) return prior.owner().equals(actor) && prior.command().equals(cmd)
                    ? answer(actor, 200, "REPLAYED") : answer(actor, 409, "EVENT_ID_REUSED");
            Pallet p = state.pallets().get(clean(cmd.pallet()));
            if (p == null || !actor.equals(p.owner()) || p.tag().isEmpty() || !p.tag().equals(cmd.tag())) {
                return answer(actor, 409, "STALE_MATCH");
            }
            String customer = clean(cmd.customer()).isEmpty() ? factory : customerName(actor, factory, cmd.customer());
            if (customer == null) return answer(actor, 400, "INVALID_CUSTOMER");
            var images = new ArrayList<byte[]>();
            for (String photo : cmd.pictures()) {
                if (photo == null || !photo.startsWith("data:image/jpeg;base64,")) return answer(actor, 400, "INVALID_PHOTO");
                try {
                    byte[] jpeg = java.util.Base64.getDecoder().decode(photo.substring(23));
                    try (var stream = javax.imageio.ImageIO.createImageInputStream(new java.io.ByteArrayInputStream(jpeg))) {
                        var readers = javax.imageio.ImageIO.getImageReaders(stream);
                        if (!readers.hasNext()) return answer(actor, 400, "INVALID_PHOTO");
                        var reader = readers.next();
                        try {
                            reader.setInput(stream);
                            if (!reader.getFormatName().equalsIgnoreCase("JPEG") || reader.getWidth(0) <= 0 || reader.getHeight(0) <= 0) {
                                return answer(actor, 400, "INVALID_PHOTO");
                            }
                        } finally { reader.dispose(); }
                    }
                    images.add(jpeg);
                } catch (IllegalArgumentException | IOException ex) { return answer(actor, 400, "INVALID_PHOTO"); }
            }
            String code = tagDetails.get(p.tag()).code();
            String day = cmd.date().format(DateTimeFormatter.BASIC_ISO_DATE);
            int ordinal = packets.values().stream().filter(packet -> packet.box().date().equals(cmd.date().toString())
                    && packet.box().tagCode().equals(code)).mapToInt(packet -> packet.images().size()).sum() + images.size();
            String file = day + "_" + code + "_" + String.format("%03d", ordinal) + ".jpg";
            String number = nextDayNumber(packets.keySet().stream());
            var box = new Box(number, cmd.date().toString(), cmd.pallet(), p.tag(), code, customer, file, "");
            packets.put(number, new Packet(actor, cmd, box, List.copyOf(images)));
            boxRequests.put(key, number);
            return answer(actor, 200, "PACKED");
        }

        private String nextDayNumber(java.util.stream.Stream<String> existing) {
            String day = LocalDate.now(ZONE).format(DateTimeFormatter.BASIC_ISO_DATE);
            return Long.toString(existing.filter(number -> number.startsWith(day)).mapToLong(Long::parseLong)
                    .max().orElse(Long.parseLong(day + "0000")) + 1);
        }

        synchronized ResponseEntity<byte[]> picture(Actor actor, String key) {
            Packet packet = packets.get(key);
            if (packet == null || !actor.equals(packet.owner())) return ResponseEntity.notFound().build();
            var images = packet.images();
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(images.get(images.size()-1));
        }

        synchronized ResponseEntity<Reply> manual(Actor actor, String factory, MoveCommand cmd) {
            String key = clean(cmd.requestId());
            if (key.isEmpty() || FIXTURE_EVENT.equals(key) || cmd.date() == null ||
                    !("IN".equals(cmd.direction()) || "OUT".equals(cmd.direction()))) return answer(actor, 400, "INVALID_INPUT");
            var prior = manualReceipts.get(key);
            if (prior != null) return prior.owner().equals(actor) && prior.command().equals(cmd)
                    ? answer(actor, 200, "REPLAYED") : answer(actor, 409, "EVENT_ID_REUSED");
            if (state.receipts().containsKey(key)) return answer(actor, 409, "EVENT_ID_REUSED");
            var packet = packets.get(clean(cmd.box()));
            if (packet == null || !packet.owner().equals(actor)) return answer(actor, 404, "BOX_NOT_FOUND");
            var box = packet.box();
            var pallet = state.pallets().get(box.pallet());
            if (!pallet.tag().equals(box.tag())) return answer(actor, 409, "STALE_MATCH");
            if (cmd.direction().equals(lastDirections.get(box.id()))) return answer(actor, 409, "INVALID_SEQUENCE");
            String customer = customerName(actor, factory, clean(cmd.customer()));
            if (customer == null) return answer(actor, 400, "INVALID_CUSTOMER");
            var history = new ArrayList<>(state.history());
            history.add(new Movement(key, cmd.direction(), box.pallet(), box.tag(), pallet.items()));
            var pallets = new HashMap<>(state.pallets());
            pallets.put(box.pallet(), new Pallet(actor, pallet.tag(), pallet.items(), cmd.direction().equals("IN")));
            var stamp = LocalDateTime.now(ZONE);
            movementDetails.put(key, new HistoryEntry(key, cmd.date().toString(), stamp.format(DateTimeFormatter.ofPattern("HH:mm:ss")),
                    customer, cmd.direction(), box.pallet(), box.tagCode(), box.id(),
                    nextDayNumber(movementDetails.values().stream().map(HistoryEntry::number))));
            manualReceipts.put(key, new ManualReceipt(actor, cmd));
            lastDirections.put(box.id(), cmd.direction());
            state = new State(state.tags(), Map.copyOf(pallets), List.copyOf(history), state.receipts());
            return answer(actor, 200, "APPLIED");
        }

        synchronized ResponseEntity<Reply> saveTags(Actor actor, TagBatch batch) {
            boolean register = "register".equals(batch.action());
            if (clean(batch.requestId()).isEmpty() || !register && !"edit".equals(batch.action())
                    || batch.rows() == null || batch.rows().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
            var previous = tagReceipts.get(batch.requestId());
            if (previous != null) return previous.actor().equals(actor) && previous.batch().equals(batch)
                    ? answer(actor, 200, "REPLAYED") : answer(actor, 409, "EVENT_ID_REUSED");
            var tags = new HashMap<>(state.tags());
            var updates = new HashMap<String, Tag>();
            var codes = new java.util.HashSet<String>();
            tagDetails.values().forEach(tag -> codes.add(tag.code()));
            String prefix = LocalDate.now(ZONE).format(MONTH);
            String stamp = LocalDateTime.now(ZONE).withNano(0).toString();
            for (TagInput row : batch.rows()) {
                if (row == null || clean(row.id()).isEmpty() || clean(row.code()).isEmpty() || row.enabled() == null
                        || updates.containsKey(row.id())) return answer(actor, 400, "INVALID_INPUT");
                Tag prior = tagDetails.get(row.id());
                if (register) {
                    if (prior != null) return answer(actor, 409, "ALREADY_REGISTERED");
                    if (!row.code().matches(prefix + "[0-9]{4}") || row.code().endsWith("0000")
                            || !codes.add(row.code())) return answer(actor, 409, "TAG_CODE_CONFLICT");
                    tags.put(row.id(), actor);
                    updates.put(row.id(), new Tag(row.id(), row.code(), row.enabled(), actor.worker(), stamp));
                } else {
                    if (!actor.equals(tags.get(row.id())) || prior == null || !prior.code().equals(row.code())) {
                        return answer(actor, 404, "TAG_NOT_FOUND");
                    }
                    updates.put(row.id(), new Tag(prior.id(), prior.code(), row.enabled(), prior.worker(), prior.registeredAt()));
                }
            }
            state = new State(Map.copyOf(tags), state.pallets(), state.history(), state.receipts());
            tagDetails.putAll(updates);
            tagReceipts.put(batch.requestId(), new BatchReceipt(actor, batch));
            return answer(actor, 200, register ? "REGISTERED" : "UPDATED");
        }

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
            if (manualReceipts.containsKey(command.eventId())) return answer(actor, 409, "EVENT_ID_REUSED");
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
            Tag newTag = null;
            Pallet pallet = pallets.get(command.pallet());
            Actor tagOwner = tags.get(command.tag());
            switch (command.action()) {
                case "register" -> {
                    if (command.tag().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                    if (tagOwner != null) return answer(actor, 409, "ALREADY_REGISTERED");
                    String nextCode = nextTagCode();
                    if (nextCode.isEmpty()) return answer(actor, 409, "TAG_CODE_CONFLICT");
                    newTag = new Tag(command.tag(), nextCode, true, actor.worker(),
                            LocalDateTime.now(ZONE).withNano(0).toString());
                    tags.put(command.tag(), actor);
                    code = "REGISTERED";
                }
                case "match", "matchScan" -> {
                    if (command.tag().isEmpty() || command.pallet().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                    if (CATALOG.pallets().stream().anyMatch(master -> master.number().equals(command.pallet()) &&
                            (!actor.terminal().equals(master.terminal()) || !actor.worker().equals(master.worker())))) {
                        return answer(actor, 403, "PALLET_ACTOR_MISMATCH");
                    }
                    if (tagOwner == null && command.action().equals("matchScan")) {
                        if (pallet == null) return answer(actor, 404, "PALLET_NOT_FOUND");
                        String nextCode = nextTagCode();
                        if (nextCode.isEmpty()) return answer(actor, 409, "TAG_CODE_CONFLICT");
                        newTag = new Tag(command.tag(), nextCode, true, actor.worker(),
                                LocalDateTime.now(ZONE).withNano(0).toString());
                        tags.put(command.tag(), actor);
                        tagOwner = actor;
                    }
                    if (tagOwner == null) return answer(actor, 404, "TAG_NOT_FOUND");
                    if (!actor.equals(tagOwner)) return answer(actor, 403, "TAG_ACTOR_MISMATCH");
                    if (pallet != null && !actor.equals(pallet.owner())) return answer(actor, 403, "PALLET_ACTOR_MISMATCH");
                    if (command.action().equals("match") && pallet != null && !pallet.tag().isEmpty() || pallets.values().stream().anyMatch(row -> row.tag().equals(command.tag()))) {
                        return answer(actor, 409, "ALREADY_MATCHED");
                    }
                    pallets.put(command.pallet(), new Pallet(actor, command.tag(), pallet == null ? List.of() : pallet.items(),
                            pallet != null && pallet.inside()));
                    code = "MATCHED";
                }
                case "unmatch" -> {
                    if (pallet == null || !actor.equals(pallet.owner())) return answer(actor, 404, "PALLET_NOT_FOUND");
                    if (pallet.tag().isEmpty() || !pallet.tag().equals(command.tag())) return answer(actor, 409, "STALE_MATCH");
                    pallets.put(command.pallet(), new Pallet(actor, "", pallet.items(), pallet.inside()));
                    code = "UNMATCHED";
                }
                case "load", "in", "out" -> {
                    if (command.pallet().isEmpty()) return answer(actor, 400, "INVALID_INPUT");
                    if (pallet == null || pallet.tag().isEmpty()) return answer(actor, 409, "INVALID_SEQUENCE");
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
            if (newTag != null) tagDetails.put(newTag.id(), newTag);
            if (code.equals("APPLIED")) {
                var stamp = LocalDateTime.now(ZONE).withNano(0);
                movementDetails.put(command.eventId(), new HistoryEntry(command.eventId(), stamp.toLocalDate().toString(),
                        stamp.toLocalTime().format(DateTimeFormatter.ofPattern("HH:mm:ss")), "",
                        command.action().equals("in") ? "IN" : "OUT", command.pallet(), tagDetails.get(pallet.tag()).code(), "", ""));
            }
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
