package synthetic.planning;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class InMemoryPlanningDomain implements PlanningDomain {
    private static final BigDecimal ZERO = new BigDecimal("0.000");
    private static final BigDecimal MAX = new BigDecimal("999999.999");
    private record Receipt(Actor actor, Command command, Result result) {}
    private record Draft(OrderKey origin, PlanKey parent, Branch branch, String item, Spec spec,
                         MaterialUse materialUse, boolean newCatalogItem) {}

    private static final class Ledger {
        final Map<String, Boolean> terminals;
        final Set<String> warehouses;
        final Map<OrderKey, Order> orders = new LinkedHashMap<>();
        final Map<PlanKey, Plan> plans = new LinkedHashMap<>();
        final Map<MaterialKey, Material> materials = new LinkedHashMap<>();
        final Map<Spec, String> catalog = new HashMap<>();
        final Map<String, Receipt> receipts = new HashMap<>();
        long revision;
        int sequence;

        Ledger(Seed seed) {
            terminals = seed.terminals();
            warehouses = seed.warehouses();
            seed.orders().forEach(row -> orders.put(row.key(), row));
            seed.plans().forEach(row -> plans.put(row.key(), row));
            seed.materials().forEach(row -> materials.put(row.key(), row));
            seed.catalog().forEach((spec, item) -> catalog.put(normalize(spec), item));
            sequence = seed.plans().stream().mapToInt(row -> row.key().sequence()).max().orElse(0);
        }
    }

    private final Clock clock;
    private final Map<Site, Ledger> ledgers = new HashMap<>();

    public InMemoryPlanningDomain(Clock clock, Map<Site, Seed> seeds) {
        this.clock = Objects.requireNonNull(clock);
        seeds.forEach((site, seed) -> ledgers.put(site, new Ledger(seed)));
    }

    @Override
    public synchronized Reply<View> view(Actor actor, Filter filter) {
        if (!valid(actor)) return fail(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.site());
        if (!allowed(ledger, actor)) return fail(403, "TERMINAL_OUT_OF_SCOPE");
        if (filter == null) filter = new Filter(null, null, null, null);
        if (filter.from() != null && filter.to() != null && filter.from().isAfter(filter.to())) {
            return fail(422, "INVALID_DATE_RANGE");
        }
        Filter criteria = filter;
        var plans = ledger.plans.values().stream().filter(plan -> matches(plan, criteria))
                .sorted(Comparator.comparing((Plan plan) -> plan.key().date())
                        .thenComparingInt(plan -> plan.key().sequence())).toList();
        return ok(new View(actor, ledger.revision, ledger.terminals.get(actor.terminal()),
                ledger.warehouses.stream().sorted().toList(), java.util.List.copyOf(ledger.orders.values()),
                plans, java.util.List.copyOf(ledger.materials.values())));
    }

    @Override
    public synchronized Reply<Result> execute(Actor actor, Command raw) {
        if (!valid(actor)) return fail(401, "LOGIN_REQUIRED");
        Ledger ledger = ledgers.get(actor.site());
        if (!allowed(ledger, actor) || !ledger.terminals.get(actor.terminal())) {
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
        if (!ledger.warehouses.contains(command.warehouse())) return fail(403, "WAREHOUSE_OUT_OF_SCOPE");

        return command.action() == Action.REVERSE_ISSUE
                ? reverse(ledger, actor, command) : change(ledger, actor, command);
    }

    private Reply<Result> reverse(Ledger ledger, Actor actor, Command command) {
        Order order = ledger.orders.get(command.originalOrder());
        if (order == null) return fail(404, "ORDER_NOT_FOUND");
        BigDecimal issued = order.issued().add(command.quantity());
        if (issued.compareTo(order.ordered()) > 0) return fail(409, "ORDER_QUANTITY_EXCEEDED");

        Draft draft = new Draft(order.key(), null, Branch.REVERSE, order.item(), normalize(order.spec()), null, false);
        Plan created = createPlan(ledger, actor, command, draft);
        ledger.orders.put(order.key(), new Order(order.key(), order.customer(), order.item(),
                order.spec(), order.warehouse(), order.ordered(), issued));
        return commit(ledger, actor, command, created);
    }

    private Reply<Result> change(Ledger ledger, Actor actor, Command command) {
        Plan target = ledger.plans.get(command.targetPlan());
        if (target == null) return fail(404, "PLAN_NOT_FOUND");
        if (target.status() != Status.PLANNED) return fail(409, "PLAN_NOT_EDITABLE");
        if (normalize(target.spec()).equals(command.spec())) return fail(422, "SPEC_UNCHANGED");
        BigDecimal allocated = target.allocated().add(command.quantity());
        if (allocated.compareTo(target.quantity()) > 0) return fail(409, "PLAN_QUANTITY_EXCEEDED");

        Material material = ledger.materials.get(command.sourceMaterial());
        if (material == null) return fail(404, "MATERIAL_NOT_FOUND");
        if (!target.item().equals(material.key().item())
                || !normalize(target.spec()).equals(normalize(material.spec()))
                || !material.spec().quality().equals(command.spec().quality())) {
            return fail(422, "MATERIAL_SPEC_MISMATCH");
        }
        BigDecimal remaining = material.available().subtract(command.inputQuantity());
        if (remaining.signum() < 0) return fail(409, "INSUFFICIENT_MATERIAL");

        String item = ledger.catalog.get(command.spec());
        boolean newItem = item == null;
        if (newItem) item = "SPEC-DEMO-" + (ledger.sequence + 1);
        Draft draft = new Draft(target.originalOrder(), target.key(), Branch.SPEC_CHANGE, item, command.spec(),
                new MaterialUse(material.key(), command.inputQuantity()), newItem);
        Plan created = createPlan(ledger, actor, command, draft);
        Plan parent = new Plan(target.key(), target.branch(), target.status(), target.originalOrder(), target.sourcePlan(),
                target.issuedOrder(), target.item(), target.spec(), target.warehouse(), target.quantity(), allocated,
                target.materialUse(), target.createdBy());
        ledger.plans.put(parent.key(), parent);
        ledger.materials.put(material.key(), new Material(material.key(), material.spec(), remaining));
        if (draft.newCatalogItem()) ledger.catalog.put(draft.spec(), draft.item());
        return commit(ledger, actor, command, created);
    }

    private Plan createPlan(Ledger ledger, Actor actor, Command command, Draft draft) {
        LocalDate date = LocalDate.now(clock);
        int sequence = Math.incrementExact(ledger.sequence);
        return new Plan(new PlanKey(date, sequence), draft.branch(), Status.PLANNED, draft.origin(), draft.parent(),
                new OrderKey("ISSUED-DEMO-" + date + "-" + sequence, 0, 1), draft.item(), draft.spec(),
                command.warehouse(), command.quantity(), ZERO, draft.materialUse(), actor);
    }

    private static Reply<Result> commit(Ledger ledger, Actor actor, Command command, Plan plan) {
        ledger.sequence = plan.key().sequence();
        ledger.plans.put(plan.key(), plan);
        Result result = new Result(++ledger.revision, plan);
        ledger.receipts.put(command.requestId(), new Receipt(actor, command, result));
        return ok(result);
    }

    private static boolean matches(Plan plan, Filter filter) {
        return (filter.from() == null || !plan.key().date().isBefore(filter.from()))
                && (filter.to() == null || !plan.key().date().isAfter(filter.to()))
                && (filter.status() == null || plan.status() == filter.status())
                && (filter.branch() == null || plan.branch() == filter.branch());
    }

    private static boolean valid(Command command) {
        if (command == null || command.action() == null || blank(command.requestId())
                || command.requestId().length() > 128 || command.expectedRevision() == null
                || command.expectedRevision() < 0 || blank(command.warehouse()) || !amount(command.quantity())) {
            return false;
        }
        if (command.action() == Action.REVERSE_ISSUE) {
            var key = command.originalOrder();
            return key != null && !blank(key.number()) && key.history() >= 0 && key.line() > 0
                    && command.quantity().compareTo(BigDecimal.ONE) >= 0 && command.targetPlan() == null
                    && command.spec() == null && command.sourceMaterial() == null && command.inputQuantity() == null;
        }
        var key = command.targetPlan();
        var material = command.sourceMaterial();
        return command.originalOrder() == null && key != null && key.date() != null && key.sequence() > 0
                && material != null && !blank(material.item()) && !blank(material.lot()) && !blank(material.warehouse())
                && !blank(material.position()) && amount(command.inputQuantity()) && valid(command.spec());
    }

    private static boolean valid(Spec spec) {
        return spec != null && !blank(spec.quality()) && spec.workState() != null
                && amount(spec.thickness()) && amount(spec.width()) && amount(spec.length());
    }

    private static boolean amount(BigDecimal number) {
        return number != null && number.signum() > 0 && number.compareTo(MAX) <= 0
                && number.stripTrailingZeros().scale() <= 3;
    }

    private static Command normalize(Command command) {
        return new Command(command.action(), command.requestId(), command.expectedRevision(), command.originalOrder(),
                command.targetPlan(), command.warehouse(), command.quantity().setScale(3),
                command.spec() == null ? null : normalize(command.spec()), command.sourceMaterial(),
                command.inputQuantity() == null ? null : command.inputQuantity().setScale(3));
    }

    private static Spec normalize(Spec spec) {
        return new Spec(spec.quality(), spec.workState(), spec.thickness().setScale(3),
                spec.width().setScale(3), spec.length().setScale(3));
    }

    private static boolean allowed(Ledger ledger, Actor actor) {
        return ledger != null && ledger.terminals.containsKey(actor.terminal());
    }

    private static boolean valid(Actor actor) {
        return actor != null && actor.site() != null && !blank(actor.terminal()) && !blank(actor.worker());
    }

    private static boolean blank(String text) {
        return text == null || text.isBlank();
    }

    private static <T> Reply<T> ok(T value) { return new Reply<>(200, null, value); }
    private static <T> Reply<T> fail(int status, String error) { return new Reply<>(status, error, null); }
}
