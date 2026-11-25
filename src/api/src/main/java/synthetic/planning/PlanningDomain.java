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
    record Reply<T>(int status, String error, T value) {}

    Reply<View> view(Actor actor, Filter filter);
    Reply<Result> execute(Actor actor, Command command);
}
