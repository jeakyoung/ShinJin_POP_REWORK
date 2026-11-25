package synthetic.basket;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;

public interface BasketDomain {
    enum Mode { BASKET, ALL_LIST, CHECKED_LIST }
    enum Action { SAVE_BASKET, START_BASKET, DELETE_UNFINISHED }
    enum Phase { READY, BASKETED, STARTED, COMPLETED }

    record Scope(String factory, String site, String center) {}
    record Actor(Scope scope, String terminal, String worker) {}
    record PlanKey(LocalDate date, int sequence) {}
    record Plan(PlanKey key, String order, int orderLine, String item) {}
    record Lot(String item, String lot, String warehouse, String position) {}
    record Issue(Lot lot, BigDecimal quantity) {}
    record ReturnLine(Lot lot, BigDecimal quantity, BigDecimal length) {}
    record Work(Plan plan, Phase phase, String groupId) {}
    record Group(String id, String terminal, List<Issue> issues, List<ReturnLine> returns, Instant startedAt) {
        public Group {
            issues = List.copyOf(issues);
            returns = List.copyOf(returns);
        }
    }
    record Seed(Mode mode, Map<String, Boolean> terminals, List<Work> work, List<Group> groups,
                Map<Lot, BigDecimal> stock, Set<Lot> returnCandidates) {
        public Seed {
            terminals = Map.copyOf(terminals);
            work = List.copyOf(work);
            groups = List.copyOf(groups);
            stock = Map.copyOf(stock);
            returnCandidates = Set.copyOf(returnCandidates);
        }
    }
    record Material(Lot lot, BigDecimal available) {}
    record View(Actor actor, Mode mode, boolean canWrite, long revision, List<Work> work,
                List<Group> groups, List<Material> materials, List<Lot> returnCandidates) {
        public View {
            work = List.copyOf(work);
            groups = List.copyOf(groups);
            materials = List.copyOf(materials);
            returnCandidates = List.copyOf(returnCandidates);
        }
    }
    record Command(Action action, String requestId, Long expectedRevision, List<PlanKey> visible,
                   List<PlanKey> selected, List<Issue> issues, List<ReturnLine> returns) {
        public Command {
            visible = visible == null ? List.of() : List.copyOf(visible);
            selected = selected == null ? List.of() : List.copyOf(selected);
            issues = issues == null ? List.of() : List.copyOf(issues);
            returns = returns == null ? List.of() : List.copyOf(returns);
        }
    }
    record Result(long revision, List<PlanKey> affected, String groupId) {
        public Result { affected = List.copyOf(affected); }
    }
    record Reply<T>(int status, String error, T value) {}

    Reply<View> view(Actor actor);
    Reply<Result> execute(Actor actor, Command command);
}
