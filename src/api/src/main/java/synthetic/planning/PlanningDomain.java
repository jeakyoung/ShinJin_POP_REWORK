package synthetic.planning;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface PlanningDomain {
    enum Action { REVERSE_ISSUE, CHANGE_SPEC }
    enum Branch { STANDARD, REVERSE, SPEC_CHANGE }
    enum Status { PLANNED, STARTED, COMPLETED }
    enum WorkState { CUT, FINISHED }

    record Site(String factory, String site, String workCenter) {}
    record Actor(Site site, String terminal, String worker) {}
    record OrderKey(String number, int history, int line) {}
    record PlanKey(LocalDate date, int sequence) {}
    record Spec(String quality, WorkState workState, BigDecimal thickness, BigDecimal width, BigDecimal length) {}
    record Order(OrderKey key, String customer, String item, Spec spec, String warehouse,
                 BigDecimal ordered, BigDecimal issued) {}
    record MaterialKey(String item, String lot, String warehouse, String position) {}
    record Material(MaterialKey key, Spec spec, BigDecimal available) {}
    record MaterialUse(MaterialKey source, BigDecimal quantity) {}
    record Plan(PlanKey key, Branch branch, Status status, OrderKey originalOrder, PlanKey sourcePlan,
                OrderKey issuedOrder, String item, Spec spec, String warehouse, BigDecimal quantity,
                BigDecimal allocated, MaterialUse materialUse, Actor createdBy) {}
    record Seed(Map<String, Boolean> terminals, Set<String> warehouses, List<Order> orders, List<Plan> plans,
                List<Material> materials, Map<Spec, String> catalog) {
        public Seed {
            terminals = Map.copyOf(terminals);
            warehouses = Set.copyOf(warehouses);
            orders = List.copyOf(orders);
            plans = List.copyOf(plans);
            materials = List.copyOf(materials);
            catalog = Map.copyOf(catalog);
        }
    }
    record Filter(LocalDate from, LocalDate to, Status status, Branch branch) {}
    record View(Actor actor, long revision, boolean canWrite, List<String> warehouses,
                List<Order> orders, List<Plan> plans, List<Material> materials) {
        public View {
            warehouses = List.copyOf(warehouses);
            orders = List.copyOf(orders);
            plans = List.copyOf(plans);
            materials = List.copyOf(materials);
        }
    }
    record Command(Action action, String requestId, Long expectedRevision, OrderKey originalOrder,
                   PlanKey targetPlan, String warehouse, BigDecimal quantity, Spec spec,
                   MaterialKey sourceMaterial, BigDecimal inputQuantity) {}
    record Result(long revision, Plan plan) {}
    record ManagementCommand(String requestId, Long expectedRevision, String warehouse, Spec spec, BigDecimal quantity) {}
    record ManagementPlan(String id, java.time.YearMonth month, String warehouse, String item, Spec spec,
                          BigDecimal quantity, Actor createdBy) {}
    record BatchCommand(String requestId, Long expectedRevision, List<Command> rows) {}
    record FollowupResult(long revision, ManagementPlan management, List<Plan> plans) {}
    record FollowupView(long revision, List<ManagementPlan> management) {}

    Reply<FollowupView> followups(Actor actor);
    Reply<FollowupResult> addManagement(Actor actor, ManagementCommand command);
    Reply<FollowupResult> batch(Actor actor, BatchCommand command);
    enum OutputMode { SINGLE, MULTIPLE }
    record PlanOutputSelection(Site site, OutputMode mode, List<PlanKey> plans) {}
    record PlanOutputCommand(String requestId, Long expectedRevision, PlanOutputSelection selection) {}
    record PlanOutputRow(PlanKey plan, OrderKey originalOrder, OrderKey issuedOrder, String item,
                         BigDecimal quantity, int printCount) {}
    record PlanOutput(long revision, OutputMode mode, Branch branch, List<PlanOutputRow> rows) {}

    Reply<PlanOutput> previewOutput(Actor actor, PlanOutputSelection selection);
    Reply<PlanOutput> prepareOutput(Actor actor, PlanOutputCommand command);
    Reply<PlanOutput> executeOutput(Actor actor, PlanOutputCommand command);
    Reply<PlanOutput> processOutput(Actor actor, PlanOutputCommand command, boolean commit);
    Reply<PlanOutput> processPreview(Actor actor, PlanOutputSelection selection);

    record Reply<T>(int status, String error, T value) {}

    Reply<View> view(Actor actor, Filter filter);
    Reply<Result> execute(Actor actor, Command command);
}
