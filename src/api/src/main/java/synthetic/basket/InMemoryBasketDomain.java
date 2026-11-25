package synthetic.basket;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

public final class InMemoryBasketDomain implements BasketDomain {
    private static final BigDecimal ZERO = new BigDecimal("0.000");
    private static final BigDecimal MAX = new BigDecimal("999999.999");
    private static final Comparator<PlanKey> KEY_ORDER = Comparator.comparing(PlanKey::date)
            .thenComparingInt(PlanKey::sequence);
    private static final Comparator<Lot> LOT_ORDER = Comparator.comparing(Lot::item).thenComparing(Lot::lot)
            .thenComparing(Lot::warehouse).thenComparing(Lot::position);
    private record Receipt(Actor actor, Command command, Result result) {}

    private static final class Ledger {
        final Seed seed;
        final Map<PlanKey, Work> work = new LinkedHashMap<>();
        final Map<String, Group> groups = new LinkedHashMap<>();
        final Map<String, Receipt> receipts = new HashMap<>();
        long revision;
        long sequence;

        Ledger(Seed seed) {
            this.seed = seed;
            seed.work().forEach(row -> work.put(row.plan().key(), row));
            seed.groups().forEach(group -> groups.put(group.id(), group));
        }
    }

    private final Map<Scope, Ledger> ledgers = new HashMap<>();
    private final Clock clock;

    public InMemoryBasketDomain(Clock clock, Map<Scope, Seed> seeds) {
        this.clock = Objects.requireNonNull(clock);
        seeds.forEach((scope, seed) -> ledgers.put(scope, new Ledger(seed)));
    }

    @Override
    public synchronized Reply<View> view(Actor actor) {
        if (!valid(actor)) return fail(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.scope());
        if (!allowed(ledger, actor)) return fail(403, "TERMINAL_OUT_OF_SCOPE");
        var reserved = reservations(ledger, Set.of());
        var materials = ledger.seed.stock().entrySet().stream().sorted(Map.Entry.comparingByKey(LOT_ORDER))
                .map(entry -> new Material(entry.getKey(),
                        entry.getValue().subtract(reserved.getOrDefault(entry.getKey(), ZERO)))).toList();
        return ok(new View(actor, ledger.seed.mode(), ledger.seed.terminals().get(actor.terminal()), ledger.revision,
                List.copyOf(ledger.work.values()), List.copyOf(ledger.groups.values()), materials,
                ledger.seed.returnCandidates().stream().sorted(LOT_ORDER).toList()));
    }

    @Override
    public synchronized Reply<Result> execute(Actor actor, Command raw) {
        if (!valid(actor)) return fail(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.scope());
        if (!allowed(ledger, actor) || !ledger.seed.terminals().get(actor.terminal())) {
            return fail(403, "TERMINAL_OUT_OF_SCOPE");
        }
        if (!valid(raw)) return fail(422, "INVALID_COMMAND");
        Command command = normalize(raw);
        Receipt receipt = ledger.receipts.get(command.requestId());
        if (receipt != null) {
            if (!receipt.actor().equals(actor)) return fail(403, "COMMAND_ACTOR_MISMATCH");
            return receipt.command().equals(command) ? ok(receipt.result()) : fail(409, "REQUEST_ID_REUSED");
        }
        if (command.expectedRevision() != ledger.revision) return fail(409, "STALE_REVISION");
        if (command.action() != Action.DELETE_UNFINISHED && ledger.seed.mode() != Mode.BASKET) {
            return fail(403, "BASKET_NOT_AVAILABLE");
        }
        if (!ledger.work.keySet().containsAll(command.visible())) return fail(404, "WORK_NOT_FOUND");

        return switch (command.action()) {
            case SAVE_BASKET -> save(ledger, actor, command);
            case START_BASKET -> start(ledger, actor, command);
            case DELETE_UNFINISHED -> delete(ledger, actor, command);
        };
    }

    private Reply<Result> save(Ledger ledger, Actor actor, Command command) {
        Set<String> replacing = new HashSet<>();
        for (PlanKey key : command.selected()) {
            Work row = ledger.work.get(key);
            if (row.phase() != Phase.READY && row.phase() != Phase.BASKETED) return fail(409, "WORK_ALREADY_STARTED");
            if (row.groupId() != null) {
                Group group = ledger.groups.get(row.groupId());
                if (!group.terminal().equals(actor.terminal())) return fail(403, "GROUP_TERMINAL_MISMATCH");
                replacing.add(group.id());
            }
        }
        for (String id : replacing) {
            if (!command.selected().containsAll(members(ledger, id))) return fail(409, "GROUP_REPLACE_REQUIRES_ALL");
        }
        if (command.returns().stream().anyMatch(row -> !ledger.seed.returnCandidates().contains(row.lot()))) {
            return fail(422, "RETURN_LOCATION_NOT_ALLOWED");
        }
        var reserved = reservations(ledger, replacing);
        for (Issue row : command.issues()) {
            BigDecimal available = ledger.seed.stock().get(row.lot());
            if (available == null) return fail(422, "ISSUE_LOT_NOT_FOUND");
            if (available.subtract(reserved.getOrDefault(row.lot(), ZERO)).compareTo(row.quantity()) < 0) {
                return fail(409, "INSUFFICIENT_MATERIAL");
            }
        }

        long sequence = ledger.sequence + 1;
        while (ledger.groups.containsKey("BASKET-DEMO-" + sequence)) sequence++;
        String id = "BASKET-DEMO-" + sequence;
        ledger.sequence = sequence;
        replacing.forEach(ledger.groups::remove);
        ledger.groups.put(id, new Group(id, actor.terminal(), command.issues(), command.returns(), null));
        setPhase(ledger, command.selected(), Phase.BASKETED, id);
        return commit(ledger, actor, command, command.selected(), id);
    }

    private Reply<Result> start(Ledger ledger, Actor actor, Command command) {
        Work first = ledger.work.get(command.visible().get(0));
        String id = first.groupId();
        if (id == null || command.visible().stream().map(ledger.work::get)
                .anyMatch(row -> row.phase() != Phase.BASKETED || !id.equals(row.groupId()))) {
            return fail(409, "BASKET_REQUIRED");
        }
        if (!command.visible().containsAll(members(ledger, id))) return fail(409, "START_REQUIRES_WHOLE_GROUP");
        Group group = ledger.groups.get(id);
        if (!group.terminal().equals(actor.terminal())) return fail(403, "GROUP_TERMINAL_MISMATCH");
        var started = new Group(id, group.terminal(), group.issues(), group.returns(), clock.instant());
        ledger.groups.put(id, started);
        setPhase(ledger, command.visible(), Phase.STARTED, id);
        return commit(ledger, actor, command, command.visible(), id);
    }

    private Reply<Result> delete(Ledger ledger, Actor actor, Command command) {
        if (command.visible().stream().map(ledger.work::get).anyMatch(row -> row.phase() == Phase.COMPLETED)) {
            return fail(409, "COMPLETED_IN_LIST");
        }
        List<PlanKey> keys = ledger.seed.mode() == Mode.CHECKED_LIST ? command.selected() : command.visible();
        if (keys.isEmpty()) return fail(422, "SELECTION_REQUIRED");
        List<PlanKey> persisted = keys.stream().filter(key -> ledger.work.get(key).phase() != Phase.READY).toList();
        if (persisted.isEmpty()) return fail(409, "NO_PERSISTED_WORK");
        Set<String> touched = new HashSet<>();
        for (PlanKey key : persisted) {
            String id = ledger.work.get(key).groupId();
            Group group = ledger.groups.get(id);
            if (group == null || !group.terminal().equals(actor.terminal())) {
                return fail(403, "GROUP_TERMINAL_MISMATCH");
            }
            touched.add(id);
        }
        setPhase(ledger, persisted, Phase.READY, null);
        for (String id : touched) {
            if (members(ledger, id).isEmpty()) ledger.groups.remove(id);
        }
        return commit(ledger, actor, command, keys, null);
    }

    private static void setPhase(Ledger ledger, List<PlanKey> keys, Phase phase, String groupId) {
        keys.forEach(key -> ledger.work.put(key, new Work(ledger.work.get(key).plan(), phase, groupId)));
    }

    private static Set<PlanKey> members(Ledger ledger, String groupId) {
        return ledger.work.values().stream().filter(row -> groupId.equals(row.groupId())).map(row -> row.plan().key())
                .collect(Collectors.toSet());
    }

    private static Map<Lot, BigDecimal> reservations(Ledger ledger, Set<String> excluding) {
        Map<Lot, BigDecimal> reserved = new HashMap<>();
        ledger.groups.forEach((id, group) -> {
            if (!excluding.contains(id)) group.issues().forEach(row -> reserved.merge(row.lot(), row.quantity(), BigDecimal::add));
        });
        return reserved;
    }

    private static Reply<Result> commit(Ledger ledger, Actor actor, Command command, List<PlanKey> keys, String id) {
        Result result = new Result(++ledger.revision, keys, id);
        ledger.receipts.put(command.requestId(), new Receipt(actor, command, result));
        return ok(result);
    }

    private static boolean valid(Command command) {
        if (command == null || command.action() == null || blank(command.requestId()) || command.requestId().length() > 128
                || command.expectedRevision() == null || command.expectedRevision() < 0
                || command.visible().isEmpty() || command.visible().size() > 100 || command.issues().size() > 100
                || command.returns().size() > 100 || !validKeys(command.visible()) || !validKeys(command.selected())
                || !command.visible().containsAll(command.selected())) return false;
        if (command.action() == Action.SAVE_BASKET) {
            return !command.selected().isEmpty() && !command.issues().isEmpty()
                    && command.issues().stream().allMatch(row -> valid(row.lot()) && amount(row.quantity()))
                    && command.returns().stream().allMatch(row -> valid(row.lot()) && amount(row.quantity()) && amount(row.length()));
        }
        return command.issues().isEmpty() && command.returns().isEmpty()
                && (command.action() != Action.START_BASKET || command.selected().isEmpty());
    }

    private static boolean validKeys(List<PlanKey> keys) {
        return keys.stream().allMatch(key -> key.date() != null && key.sequence() > 0)
                && new HashSet<>(keys).size() == keys.size();
    }

    private static Command normalize(Command command) {
        Map<Lot, BigDecimal> totals = new HashMap<>();
        command.issues().forEach(line -> totals.merge(line.lot(), line.quantity().setScale(3), BigDecimal::add));
        var issues = totals.entrySet().stream().sorted(Map.Entry.comparingByKey(LOT_ORDER))
                .map(entry -> new Issue(entry.getKey(), entry.getValue())).toList();
        var returns = command.returns().stream()
                .map(row -> new ReturnLine(row.lot(), row.quantity().setScale(3), row.length().setScale(3)))
                .sorted(Comparator.comparing(ReturnLine::lot, LOT_ORDER).thenComparing(ReturnLine::length)
                        .thenComparing(ReturnLine::quantity)).toList();
        return new Command(command.action(), command.requestId(), command.expectedRevision(),
                command.visible().stream().sorted(KEY_ORDER).toList(),
                command.selected().stream().sorted(KEY_ORDER).toList(), issues, returns);
    }

    private static boolean amount(BigDecimal value) {
        return value != null && value.signum() > 0 && value.compareTo(MAX) <= 0 && value.stripTrailingZeros().scale() <= 3;
    }

    private static boolean valid(Actor actor) {
        return actor != null && actor.scope() != null && !blank(actor.terminal()) && !blank(actor.worker());
    }

    private static boolean valid(Lot lot) {
        return lot != null && !blank(lot.item()) && !blank(lot.lot()) && !blank(lot.warehouse()) && !blank(lot.position());
    }

    private static boolean allowed(Ledger ledger, Actor actor) {
        return ledger != null && ledger.seed.terminals().containsKey(actor.terminal());
    }

    private static boolean blank(String value) { return value == null || value.isBlank(); }
    private static <T> Reply<T> ok(T value) { return new Reply<>(200, null, value); }
    private static <T> Reply<T> fail(int status, String error) { return new Reply<>(status, error, null); }
}
